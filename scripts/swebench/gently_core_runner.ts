import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { spawnSync } from 'child_process';
import Module from 'module';
import { createVscodeShim } from './vscode_shim';

type RunnerStatus = 'success' | 'no_patch' | 'invalid_patch' | 'infra_error' | 'timeout';

interface RunnerResult {
  status: RunnerStatus;
  patch: string;
  error: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  } | null;
  duration_ms: number;
  steps_completed: number;
}

interface Args {
  repoDir: string;
  problemFile: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutSec: number;
  contextWindowTokens: number;
  softTrimRatio: number;
  hardTrimRatio: number;
  outputReserveRatio: number;
  safetyReserveRatio: number;
  runnerMode: string;
  verificationModel: string;
  requireTreesitter: boolean;
  modeParityStrict: boolean;
  architectFallbackTurns: number;
}

let resultWritten = false;
const RUNNER_EVENT_PREFIX = 'RUNNER_EVENT ';

function emitRunnerEvent(
  step: string,
  status: 'info' | 'success' | 'warn' | 'error',
  message: string,
  extra: Record<string, unknown> = {}
): void {
  const evt = {
    step,
    status,
    message,
    ...extra,
  };
  process.stderr.write(`${RUNNER_EVENT_PREFIX}${JSON.stringify(evt)}\n`);
}

function redirectConsoleNoiseToStderr(): void {
  const toLine = (args: any[]) => args.map((a) => {
    if (typeof a === 'string') return a;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }).join(' ');

  console.log = (...args: any[]) => {
    process.stderr.write(`${toLine(args)}\n`);
  };
  console.info = (...args: any[]) => {
    process.stderr.write(`${toLine(args)}\n`);
  };
  console.warn = (...args: any[]) => {
    process.stderr.write(`${toLine(args)}\n`);
  };
}

function emitResult(out: RunnerResult): void {
  if (resultWritten) return;
  resultWritten = true;
  process.stdout.write(JSON.stringify(out));
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[Truncated due to context budget constraints]`;
}

function stripSchemaNoise(value: any): any {
  if (Array.isArray(value)) return value.map((item) => stripSchemaNoise(item));
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, any> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'description' || key === 'examples' || key === 'default' || key === 'title') {
      continue;
    }
    out[key] = stripSchemaNoise(nested);
  }
  return out;
}

function compactTools(tools: any[]): any[] {
  return (Array.isArray(tools) ? tools : []).map((tool) => {
    const compact = stripSchemaNoise(tool);
    const fn = compact?.function;
    if (fn && typeof fn.description !== 'string') {
      fn.description = `Use ${fn.name}`;
    }
    return compact;
  });
}

function filterFormattedToolsForMode(tools: any[], modeId: string): any[] {
  const architectAllowed = new Set([
    'handover_to_coder',
    'read_file',
    'list_files',
    'find_files',
    'analyze_project_structure',
    'recall_memories',
    'update_memory_bank',
    'query_long_term_memory',
  ]);
  const codeAllowed = new Set([
    'safe_edit_file',
    'apply_block_edit',
    'write_file',
    'read_file',
    'list_files',
    'find_files',
    'analyze_project_structure',
    'verify_and_auto_fix',
    'run_linter',
    'run_type_check',
    'execute_test',
    'create_checkpoint',
    'restore_checkpoint',
    'update_memory_bank',
    'recall_memories',
  ]);
  const allowed = modeId === 'architect' ? architectAllowed : codeAllowed;
  return (Array.isArray(tools) ? tools : []).filter((tool) => {
    const name = tool?.function?.name;
    return typeof name === 'string' && allowed.has(name);
  });
}

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key || !key.startsWith('--') || !value) continue;
    map.set(key, value);
  }

  const repoDir = map.get('--repo_dir');
  const problemFile = map.get('--problem_file');
  const model = map.get('--model');
  if (!repoDir || !problemFile || !model) {
    throw new Error('Missing required args: --repo_dir --problem_file --model');
  }

  const strictModeRaw = map.get('--mode_parity_strict') ?? process.env.GENTLY_MODE_PARITY_STRICT ?? '0';
  const fallbackTurnsRaw = map.get('--architect_fallback_turns') ?? process.env.GENTLY_ARCHITECT_FALLBACK_TURNS ?? '3';
  const parsedFallbackTurns = Number(fallbackTurnsRaw || '3');
  return {
    repoDir,
    problemFile,
    model,
    maxTokens: Number(map.get('--max_tokens') || '8192'),
    temperature: Number(map.get('--temperature') || '0.0'),
    timeoutSec: Number(map.get('--timeout_sec') || '1800'),
    contextWindowTokens: Number(map.get('--context_window_tokens') || '204800'),
    softTrimRatio: Number(map.get('--soft_trim_ratio') || '0.70'),
    hardTrimRatio: Number(map.get('--hard_trim_ratio') || '0.85'),
    outputReserveRatio: Number(map.get('--output_reserve_ratio') || '0.15'),
    safetyReserveRatio: Number(map.get('--safety_reserve_ratio') || '0.05'),
    runnerMode: String(map.get('--runner_mode') || 'gently_core_full_parity'),
    verificationModel: String(map.get('--verification_model') || model),
    requireTreesitter: String(map.get('--require_treesitter') || '1').toLowerCase() !== '0',
    modeParityStrict: String(strictModeRaw).toLowerCase() === '1' || String(strictModeRaw).toLowerCase() === 'true',
    architectFallbackTurns: Number.isFinite(parsedFallbackTurns) ? Math.max(1, parsedFallbackTurns) : 3,
  };
}

function clampRatio(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function estimateTokensFromText(text: string): number {
  // Conservative approximation for mixed code/text prompts.
  return Math.ceil(text.length / 4);
}

function estimatePromptTokens(messages: any[], tools: any[]): number {
  const payload = JSON.stringify({ messages, tools });
  return estimateTokensFromText(payload);
}

function truncateString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n[truncated]`;
}

function sanitizeToolResultForContext(value: any, maxStringChars: number = 2000): any {
  if (typeof value === 'string') {
    return truncateString(value, maxStringChars);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeToolResultForContext(item, maxStringChars));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const out: Record<string, any> = {};
  let count = 0;
  for (const [k, v] of Object.entries(value)) {
    if (count >= 40) {
      out.__truncated_keys = true;
      break;
    }
    out[k] = sanitizeToolResultForContext(v, maxStringChars);
    count += 1;
  }
  return out;
}

function pruneMessagesToBudget(messages: any[], tools: any[], promptBudget: number): { messages: any[]; prunedCount: number; beforeTokens: number; afterTokens: number } {
  if (messages.length <= 2) {
    const t = estimatePromptTokens(messages, tools);
    return { messages, prunedCount: 0, beforeTokens: t, afterTokens: t };
  }
  const beforeTokens = estimatePromptTokens(messages, tools);
  const fixed = messages.slice(0, 2); // system + initial user
  const tail = messages.slice(2);
  const kept = [...tail];

  // Drop oldest tool messages first, then oldest assistant messages.
  const removableOrder = ['tool', 'assistant'];
  for (const role of removableOrder) {
    let estimate = estimatePromptTokens([...fixed, ...kept], tools);
    while (estimate > promptBudget) {
      const idx = kept.findIndex((m) => m?.role === role);
      if (idx === -1) break;
      kept.splice(idx, 1);
      estimate = estimatePromptTokens([...fixed, ...kept], tools);
    }
  }

  // Final hard fallback: keep only newest 12 messages after fixed head.
  let merged = [...fixed, ...kept];
  let estimate = estimatePromptTokens(merged, tools);
  if (estimate > promptBudget) {
    merged = [...fixed, ...kept.slice(Math.max(0, kept.length - 12))];
  }
  const afterTokens = estimatePromptTokens(merged, tools);
  return {
    messages: merged,
    prunedCount: Math.max(0, messages.length - merged.length),
    beforeTokens,
    afterTokens,
  };
}

function compactMessages(problem: string, standards: string, profile: 'base' | 'soft' | 'hard'): { problem: string; standards: string } {
  if (profile === 'base') {
    return {
      problem: truncateText(problem, 60_000),
      standards: truncateText(standards, 5_000),
    };
  }
  if (profile === 'soft') {
    return {
      problem: truncateText(problem, 40_000),
      standards: truncateText(standards, 2_000),
    };
  }
  return {
    problem: truncateText(problem, 20_000),
    standards: truncateText(standards, 1_000),
  };
}

function installVscodeShim(repoDir: string): void {
  const moduleAny = Module as any;
  const originalLoad = moduleAny._load;
  moduleAny._load = function (request: string, parent: any, isMain: boolean) {
    if (request === 'vscode') {
      return createVscodeShim(repoDir);
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };
}

function runGit(args: string[], cwd: string, timeoutMs: number): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
  });
  return {
    code: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function getDiffStats(repoDir: string): {
  hasDiff: boolean;
  filesChanged: number;
  insertions: number;
  deletions: number;
} {
  const numstat = runGit(['diff', '--numstat', 'HEAD'], repoDir, 30_000);
  if (numstat.code !== 0) {
    return { hasDiff: false, filesChanged: 0, insertions: 0, deletions: 0 };
  }

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [insRaw, delRaw] = trimmed.split('\t');
    const ins = Number(insRaw);
    const del = Number(delRaw);
    if (Number.isFinite(ins)) insertions += ins;
    if (Number.isFinite(del)) deletions += del;
    filesChanged += 1;
  }

  return {
    hasDiff: filesChanged > 0,
    filesChanged,
    insertions,
    deletions,
  };
}

function extractPatch(repoDir: string): string {
  const diff = runGit(['diff', 'HEAD'], repoDir, 120_000);
  if (diff.code !== 0) {
    throw new Error(`git diff failed: ${diff.stderr || diff.stdout}`);
  }
  return diff.stdout;
}

function validatePatch(repoDir: string, patch: string): { valid: boolean; error?: string } {
  if (!patch.trim()) return { valid: false, error: 'Empty patch' };
  const hasDiffHeader = patch.split('\n').some((l) => l.startsWith('diff --git'));
  const hasHunk = patch.split('\n').some((l) => /^@@ -\d+,?\d* \+\d+,?\d* @@/.test(l));
  if (!hasDiffHeader) return { valid: false, error: 'Missing diff --git header' };
  if (!hasHunk) return { valid: false, error: 'Missing hunk header (@@)' };

  const patchPath = path.join(repoDir, `.gently_swebench_${Date.now()}.diff`);
  fs.writeFileSync(patchPath, patch, 'utf8');
  try {
    const check = runGit(['apply', '--check', '--cached', patchPath], repoDir, 30_000);
    if (check.code !== 0) {
      return { valid: false, error: `git apply --check failed: ${check.stderr || check.stdout}` };
    }
    return { valid: true };
  } finally {
    fs.unlinkSync(patchPath);
  }
}

function postJson(
  payload: Record<string, unknown>,
  apiKey: string,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        protocol: 'https:',
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data).toString(),
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/SneakyFresh24/Gently-Coding-Agent',
          'X-Title': 'Gently Core SWE-Bench Runner',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve({ statusCode: res.statusCode || 500, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('request_timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runToolLoop(
  args: Args,
  apiKey: string,
  toolManager: any,
  modeManager: any,
  handoverState: { requested: boolean; accepted: boolean; message?: string },
  standards: string,
  problemRaw: string
): Promise<{
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  stepsCompleted: number;
  stoppedByNoPatchGuardrail: boolean;
  noPatchReason: string | null;
}> {
  const loopStarted = Date.now();
  const contextWindow = Math.max(4_096, Number(args.contextWindowTokens || 204_800));
  const softRatio = clampRatio(args.softTrimRatio, 0.70);
  const hardRatio = clampRatio(args.hardTrimRatio, 0.85);
  const outputRatio = clampRatio(args.outputReserveRatio, 0.15);
  const safetyRatio = clampRatio(args.safetyReserveRatio, 0.05);

  const outputReserve = Math.max(256, Math.floor(contextWindow * outputRatio));
  const safetyReserve = Math.max(128, Math.floor(contextWindow * safetyRatio));
  const promptBudget = Math.max(1024, contextWindow - outputReserve - safetyReserve);
  const softLimit = Math.min(promptBudget, Math.floor(contextWindow * Math.min(softRatio, hardRatio)));
  const hardLimit = Math.min(promptBudget, Math.floor(contextWindow * Math.max(softRatio, hardRatio)));
  const effectiveMaxTokens = Math.max(256, Math.min(args.maxTokens, outputReserve));

  const toolsBase = compactTools(toolManager.getFormattedTools());
  const editToolNames = new Set([
    'safe_edit_file',
    'apply_block_edit',
    'write_file',
  ]);
  const toolsHard = toolsBase.map((tool) => {
    const cloned = { ...tool };
    if (cloned.function && cloned.function.parameters) {
      cloned.function.parameters = stripSchemaNoise(cloned.function.parameters);
    }
    return cloned;
  });

  let selected = compactMessages(problemRaw, standards, 'base');
  let tools = toolsBase;
  let sys = [
    'You are Gently running in headless benchmark mode.',
    'You must solve the repository issue using tools, by editing files in the workspace.',
    'Do not output a patch directly; use tool calls to make edits.',
    'Keep changes minimal and focused to satisfy tests for the issue.',
    'Use a context-efficient strategy: inspect only relevant files, summarize findings, avoid dumping large file contents.',
    '',
    selected.standards,
  ].join('\n');
  let messages: any[] = [
    { role: 'system', content: sys },
    { role: 'user', content: selected.problem },
  ];

  const initialEstimate = estimatePromptTokens(messages, tools);
  if (initialEstimate > softLimit) {
    emitRunnerEvent('context_compression', 'info', 'Soft compression applied', {
      stage: 'initial',
      estimated_prompt_tokens: initialEstimate,
      threshold_tokens: softLimit,
    });
    selected = compactMessages(problemRaw, standards, 'soft');
    sys = [
      'You are Gently running in headless benchmark mode.',
      'You must solve the repository issue using tools, by editing files in the workspace.',
      'Do not output a patch directly; use tool calls to make edits.',
      'Keep changes minimal and focused to satisfy tests for the issue.',
      'Use a context-efficient strategy: inspect only relevant files, summarize findings, avoid dumping large file contents.',
      '',
      selected.standards,
    ].join('\n');
    messages = [
      { role: 'system', content: sys },
      { role: 'user', content: selected.problem },
    ];
  }

  const softEstimate = estimatePromptTokens(messages, tools);
  if (softEstimate > hardLimit) {
    emitRunnerEvent('context_compression', 'warn', 'Hard compression applied', {
      stage: 'initial',
      estimated_prompt_tokens: softEstimate,
      threshold_tokens: hardLimit,
    });
    selected = compactMessages(problemRaw, standards, 'hard');
    tools = toolsHard;
    sys = [
      'You are Gently running in headless benchmark mode.',
      'You must solve the repository issue using tools, by editing files in the workspace.',
      'Do not output a patch directly; use tool calls to make edits.',
      'Keep changes minimal and focused to satisfy tests for the issue.',
      'Use a context-efficient strategy: inspect only relevant files, summarize findings, avoid dumping large file contents.',
      '',
      selected.standards,
    ].join('\n');
    messages = [
      { role: 'system', content: sys },
      { role: 'user', content: selected.problem },
    ];
  }

  const hardEstimate = estimatePromptTokens(messages, tools);
  if (hardEstimate > promptBudget) {
    emitRunnerEvent('context_compression', 'warn', 'Emergency compression applied', {
      stage: 'initial',
      estimated_prompt_tokens: hardEstimate,
      prompt_budget_tokens: promptBudget,
    });
    // Final emergency clamp to prevent hard context overflow.
    const targetChars = Math.max(8_000, Math.floor((promptBudget * 4) * 0.65));
    selected = {
      problem: truncateText(problemRaw, targetChars),
      standards: truncateText(standards, 800),
    };
    messages = [
      { role: 'system', content: [
        'You are Gently running in headless benchmark mode.',
        'Solve the issue with minimal targeted edits via tools.',
        selected.standards,
      ].join('\n') },
      { role: 'user', content: selected.problem },
    ];
    tools = toolsHard;
  }

  const maxSteps = 24;
  let stepsCompleted = 0;
  let llmCalls = 0;
  let toolCallsTotal = 0;
  let lastTool = '';
  let nextProgressAt = Date.now() + 30_000;
  const readOnlyTools = new Set([
    'read_file',
    'list_files',
    'find_files',
    'get_context',
    'analyze_project_structure',
  ]);
  const editTools = new Set(['safe_edit_file', 'apply_block_edit', 'write_file']);
  const softReadOnlyThreshold = 8;
  const hardReadOnlyThreshold = 14;
  let consecutiveReadOnlyWithoutDiff = 0;
  let softGuardrailTriggered = false;
  let repeatedReadOnlyCount = 0;
  let lastReadOnlyTool = '';
  let stoppedByNoPatchGuardrail = false;
  let noPatchReason: string | null = null;
  let rescueTurnsRemaining = 2;
  let forceEditToolPolicy = false;
  let requiredToolChoiceSupported = true;
  let lastLoggedMode = '';
  let architectTurnsWithoutHandover = 0;
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  for (let i = 0; i < maxSteps; i++) {
    const modeId = String(modeManager?.getCurrentModeId?.() || 'architect');
    if (handoverState.requested && !handoverState.accepted && modeId === 'architect') {
      await modeManager.setMode('code');
      handoverState.accepted = true;
      handoverState.requested = false;
      emitRunnerEvent('mode_transition', 'success', 'Mode switched after handover', {
        iteration: i + 1,
        from_mode: 'architect',
        to_mode: 'code',
        trigger: 'handover_to_coder',
      });
      messages.push({
        role: 'system',
        content: 'Architect handover accepted; switch to implementation.',
      });
    }

    const modeTools = filterFormattedToolsForMode(tools, modeId);
    const modeToolNames = modeTools
      .map((tool: any) => tool?.function?.name)
      .filter((name: any): name is string => typeof name === 'string');
    const allowedToolNamesSample = modeToolNames.slice(0, 10);
    const allowedToolsCount = Array.isArray(modeTools) ? modeTools.length : 0;
    if (modeId !== lastLoggedMode) {
      emitRunnerEvent('mode_state', 'info', 'Mode state updated', {
        iteration: i + 1,
        current_mode: modeId,
        allowed_tools_count: allowedToolsCount,
        allowed_tool_names_sample: allowedToolNamesSample,
      });
      lastLoggedMode = modeId;
    }
    if (modeId === 'architect' && !handoverState.accepted) {
      architectTurnsWithoutHandover += 1;
      if (!args.modeParityStrict && architectTurnsWithoutHandover >= args.architectFallbackTurns) {
        await modeManager.setMode('code');
        handoverState.accepted = true;
        emitRunnerEvent('mode_transition', 'warn', 'Auto fallback from architect to code', {
          iteration: i + 1,
          from_mode: 'architect',
          to_mode: 'code',
          trigger: 'auto_fallback_no_handover',
          architect_turns_without_handover: architectTurnsWithoutHandover,
        });
        messages.push({
          role: 'system',
          content: 'No architect handover detected. Auto-fallback to code mode for execution.',
        });
        continue;
      }
    }

    const prune = pruneMessagesToBudget(messages, modeTools, promptBudget);
    messages = prune.messages;
    if (prune.prunedCount > 0) {
      emitRunnerEvent('context_compression', 'info', 'Iteration message pruning applied', {
        stage: 'iteration',
        iteration: i + 1,
        pruned_messages: prune.prunedCount,
        before_tokens: prune.beforeTokens,
        after_tokens: prune.afterTokens,
        prompt_budget_tokens: promptBudget,
      });
    }
    const estimatedPromptTokens = estimatePromptTokens(messages, modeTools);
    emitRunnerEvent('llm_call', 'info', 'Sending LLM request', {
      iteration: i + 1,
      estimated_prompt_tokens: estimatedPromptTokens,
      max_tokens: effectiveMaxTokens,
      model: args.model,
    });
    const modeToolsEditOnly = (Array.isArray(modeTools) ? modeTools : []).filter((tool: any) => {
      const name = tool?.function?.name;
      return typeof name === 'string' && editToolNames.has(name);
    });
    const modeToolsEditPreferred = modeToolsEditOnly.length > 0 ? modeToolsEditOnly : modeTools;
    const activeTools = forceEditToolPolicy && modeId === 'code' ? modeToolsEditPreferred : modeTools;
    const preferredToolChoice = forceEditToolPolicy && modeId === 'code' && requiredToolChoiceSupported ? 'required' : 'auto';
    const toolChoiceCandidates: Array<'required' | 'auto'> =
      preferredToolChoice === 'required' ? ['required', 'auto'] : ['auto'];

    let response: { statusCode: number; body: string } | null = null;
    let usedToolChoice: 'required' | 'auto' = toolChoiceCandidates[0];
    let llmStart = Date.now();
    for (const candidateToolChoice of toolChoiceCandidates) {
      usedToolChoice = candidateToolChoice;
      llmStart = Date.now();
      const payload = {
        model: args.model,
        temperature: args.temperature,
        max_tokens: effectiveMaxTokens,
        messages,
        tools: activeTools,
        tool_choice: candidateToolChoice,
      };
      response = await postJson(payload, apiKey, args.timeoutSec * 1000);
      if (response.statusCode === 200) {
        break;
      }
      const providerRejectedRequiredToolChoice =
        candidateToolChoice === 'required'
        && response.statusCode === 404
        && response.body.toLowerCase().includes('tool_choice');
      if (providerRejectedRequiredToolChoice) {
        requiredToolChoiceSupported = false;
        emitRunnerEvent('tool_policy_switch', 'warn', 'Provider rejected required tool_choice; falling back to auto', {
          iteration: i + 1,
          from_tool_choice: 'required',
          to_tool_choice: 'auto',
          tools_mode: 'edit_preferred',
        });
        continue;
      }
      emitRunnerEvent('llm_call', 'error', 'LLM request failed', {
        iteration: i + 1,
        http_status: response.statusCode,
        tool_choice: candidateToolChoice,
      });
      throw new Error(`openrouter_http_${response.statusCode}: ${response.body}`);
    }
    if (!response || response.statusCode !== 200) {
      emitRunnerEvent('llm_call', 'error', 'LLM request failed after tool_choice fallback', {
        iteration: i + 1,
      });
      throw new Error(`openrouter_http_${response?.statusCode ?? 500}: ${response?.body ?? 'unknown error'}`);
    }
    llmCalls += 1;
    emitRunnerEvent('llm_call', 'success', 'LLM response received', {
      iteration: i + 1,
      http_status: response.statusCode,
      latency_ms: Date.now() - llmStart,
      tool_choice: usedToolChoice,
    });

    const parsed = JSON.parse(response.body);
    const choice = parsed?.choices?.[0];
    const message = choice?.message;
    const toolCalls = message?.tool_calls || [];
    const content = typeof message?.content === 'string' ? message.content : '';

    const u = parsed?.usage || {};
    usage.input_tokens += Number(u.prompt_tokens || 0);
    usage.output_tokens += Number(u.completion_tokens || 0);
    usage.total_tokens += Number(u.total_tokens || 0);

    messages.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls,
    });

    if (!toolCalls || toolCalls.length === 0) {
      const diffStatsNoTool = getDiffStats(args.repoDir);
      if (modeId === 'architect' && !handoverState.accepted) {
        if (!args.modeParityStrict && architectTurnsWithoutHandover >= args.architectFallbackTurns) {
          await modeManager.setMode('code');
          handoverState.accepted = true;
          emitRunnerEvent('mode_transition', 'warn', 'Auto fallback from architect to code', {
            iteration: i + 1,
            from_mode: 'architect',
            to_mode: 'code',
            trigger: 'auto_fallback_no_handover',
            architect_turns_without_handover: architectTurnsWithoutHandover,
          });
          messages.push({
            role: 'system',
            content: 'No architect handover detected. Auto-fallback to code mode for execution.',
          });
          continue;
        }
        emitRunnerEvent('mode_guardrail', 'warn', 'Architect finished without handover_to_coder', {
          iteration: i + 1,
          reason: 'no_handover_to_coder',
        });
        noPatchReason = 'no_handover_to_coder';
        stoppedByNoPatchGuardrail = true;
        break;
      }
      if (modeId === 'code' && !diffStatsNoTool.hasDiff && rescueTurnsRemaining > 0) {
        rescueTurnsRemaining -= 1;
        if (!forceEditToolPolicy) {
          forceEditToolPolicy = true;
          emitRunnerEvent('tool_policy_switch', 'warn', 'Switching tool policy to required edit tools', {
            iteration: i + 1,
            tool_choice: 'required',
            tools_mode: 'edit_preferred',
          });
        }
        emitRunnerEvent('tool_loop_rescue', 'warn', 'No tool calls without diff; forcing edit-focused retry', {
          iteration: i + 1,
          rescue_turns_remaining: rescueTurnsRemaining,
          tools_mode: 'edit_preferred',
        });
        messages.push({
          role: 'user',
          content:
            'No code changes detected. You must now perform a concrete file edit via safe_edit_file/apply_block_edit/write_file and then stop.',
        });
        continue;
      }
      if (modeId === 'code' && !diffStatsNoTool.hasDiff && forceEditToolPolicy) {
        emitRunnerEvent('tool_loop_rescue_failed', 'error', 'Model returned no tool calls in required rescue mode', {
          iteration: i + 1,
          tool_choice: 'required',
          tools_mode: 'edit_preferred',
        });
        noPatchReason = 'model_declined_tool_calls_after_rescue';
        stoppedByNoPatchGuardrail = true;
        break;
      }
      emitRunnerEvent('tool_loop', 'success', 'No further tool calls; finishing loop', {
        iteration: i + 1,
      });
      break;
    }

    for (const tc of toolCalls) {
      const fn = tc?.function || {};
      const name = fn.name;
      const rawArgs = fn.arguments || '{}';
      if (!name) continue;

      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        parsedArgs = {};
      }

      const toolStart = Date.now();
      emitRunnerEvent('tool_call', 'info', 'Tool execution started', {
        tool_name: name,
        iteration: i + 1,
      });
      if (!modeToolNames.includes(name)) {
        const modeBlocked = String(modeManager?.getCurrentModeId?.() || 'unknown');
        emitRunnerEvent('mode_guardrail', 'warn', 'Tool blocked by current mode policy', {
          iteration: i + 1,
          current_mode: modeBlocked,
          tool_name: name,
        });
        stepsCompleted += 1;
        toolCallsTotal += 1;
        lastTool = name;
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify({
            success: false,
            error: `Tool '${name}' is not allowed in mode '${modeBlocked}'. Use handover_to_coder before implementation tools.`,
          }),
        });
        emitRunnerEvent('tool_call', 'success', 'Tool execution blocked by mode policy', {
          tool_name: name,
          iteration: i + 1,
          duration_ms: Date.now() - toolStart,
          steps_completed: stepsCompleted,
        });
        const blockedDiffStats = getDiffStats(args.repoDir);
        emitRunnerEvent('diff_progress', 'info', 'Diff status after blocked tool call', {
          tool_name: name,
          iteration: i + 1,
          files_changed: blockedDiffStats.filesChanged,
          insertions: blockedDiffStats.insertions,
          deletions: blockedDiffStats.deletions,
          has_diff: blockedDiffStats.hasDiff,
        });
        continue;
      }
      let result: any;
      try {
        result = await toolManager.executeTool(name, parsedArgs);
      } catch (error) {
        emitRunnerEvent('tool_call', 'error', 'Tool execution failed', {
          tool_name: name,
          iteration: i + 1,
          duration_ms: Date.now() - toolStart,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      stepsCompleted += 1;
      toolCallsTotal += 1;
      lastTool = name;
      const safeToolResult = sanitizeToolResultForContext(result, 2000);
      const originalLen = JSON.stringify(result ?? {}).length;
      const safeLen = JSON.stringify(safeToolResult ?? {}).length;
      if (safeLen < originalLen) {
        emitRunnerEvent('tool_result_compression', 'info', 'Tool result compressed for context budget', {
          tool_name: name,
          iteration: i + 1,
          original_chars: originalLen,
          compressed_chars: safeLen,
        });
      }
      emitRunnerEvent('tool_call', 'success', 'Tool execution completed', {
        tool_name: name,
        iteration: i + 1,
        duration_ms: Date.now() - toolStart,
        steps_completed: stepsCompleted,
      });
      const diffStats = getDiffStats(args.repoDir);
      emitRunnerEvent('diff_progress', 'info', 'Diff status after tool call', {
        tool_name: name,
        iteration: i + 1,
        files_changed: diffStats.filesChanged,
        insertions: diffStats.insertions,
        deletions: diffStats.deletions,
        has_diff: diffStats.hasDiff,
      });

      if (diffStats.hasDiff) {
        consecutiveReadOnlyWithoutDiff = 0;
        softGuardrailTriggered = false;
        repeatedReadOnlyCount = 0;
        lastReadOnlyTool = '';
        if (forceEditToolPolicy) {
          forceEditToolPolicy = false;
          emitRunnerEvent('tool_policy_switch', 'info', 'Switching tool policy back to auto', {
            iteration: i + 1,
            tool_choice: 'auto',
          });
        }
      } else {
        if (modeId === 'code' && (readOnlyTools.has(name) || name === 'run_command')) {
          consecutiveReadOnlyWithoutDiff += 1;
          if (name === lastReadOnlyTool) {
            repeatedReadOnlyCount += 1;
          } else {
            repeatedReadOnlyCount = 1;
            lastReadOnlyTool = name;
          }
        } else if (editTools.has(name)) {
          // Edit attempt without diff still counts as no progress, but we reset strict read-only repetition.
          repeatedReadOnlyCount = 0;
          lastReadOnlyTool = '';
        }

        const repetitiveReadOnly = repeatedReadOnlyCount >= 4;
        if (modeId === 'code' && !softGuardrailTriggered && (consecutiveReadOnlyWithoutDiff >= softReadOnlyThreshold || repetitiveReadOnly)) {
          softGuardrailTriggered = true;
          if (!forceEditToolPolicy) {
            forceEditToolPolicy = true;
            emitRunnerEvent('tool_policy_switch', 'warn', 'Switching tool policy to required edit tools', {
              iteration: i + 1,
              tool_choice: 'required',
              tools_mode: 'edit_preferred',
            });
          }
          emitRunnerEvent('read_only_guardrail', 'warn', 'Soft read-only guardrail triggered', {
            iteration: i + 1,
            consecutive_read_only_without_diff: consecutiveReadOnlyWithoutDiff,
            repeated_read_only_count: repeatedReadOnlyCount,
            threshold: softReadOnlyThreshold,
            tools_mode: 'edit_preferred',
          });
          messages.push({
            role: 'user',
            content:
              'Guardrail notice: You are in a read-only loop without code diff. Stop exploring and produce a minimal edit now using edit tools (safe_edit_file/apply_block_edit/write_file).',
          });
        }

        if (modeId === 'code' && consecutiveReadOnlyWithoutDiff >= hardReadOnlyThreshold) {
          emitRunnerEvent('read_only_guardrail', 'error', 'Hard read-only guardrail triggered; stopping loop as no_patch', {
            iteration: i + 1,
            consecutive_read_only_without_diff: consecutiveReadOnlyWithoutDiff,
            threshold: hardReadOnlyThreshold,
          });
          noPatchReason = 'read_only_guardrail_hard_stop';
          stoppedByNoPatchGuardrail = true;
          break;
        }
      }
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(safeToolResult),
      });
    }

    if (stoppedByNoPatchGuardrail) {
      break;
    }

    if (Date.now() >= nextProgressAt) {
      const diffStats = getDiffStats(args.repoDir);
      emitRunnerEvent('progress_counters', 'info', 'Runner progress update', {
        elapsed_ms: Date.now() - loopStarted,
        llm_calls: llmCalls,
        tool_calls: toolCallsTotal,
        steps_completed: stepsCompleted,
        last_tool: lastTool,
        diff_active: diffStats.hasDiff,
        diff_files_changed: diffStats.filesChanged,
      });
      nextProgressAt = Date.now() + 30_000;
    }

    if (i >= maxSteps - 2) {
      const diffStats = getDiffStats(args.repoDir);
      if (!diffStats.hasDiff) {
        if (modeId === 'architect' && !handoverState.accepted) {
          if (!args.modeParityStrict) {
            await modeManager.setMode('code');
            handoverState.accepted = true;
            emitRunnerEvent('mode_transition', 'warn', 'Auto fallback from architect to code near max steps', {
              iteration: i + 1,
              from_mode: 'architect',
              to_mode: 'code',
              trigger: 'auto_fallback_no_handover',
              architect_turns_without_handover: architectTurnsWithoutHandover,
            });
            messages.push({
              role: 'system',
              content: 'No architect handover detected. Auto-fallback to code mode for execution.',
            });
            continue;
          }
          emitRunnerEvent('mode_guardrail', 'warn', 'Architect reached max steps without handover', {
            iteration: i + 1,
            max_steps: maxSteps,
            reason: 'no_handover_to_coder',
          });
          noPatchReason = 'no_handover_to_coder';
        } else {
          emitRunnerEvent('read_only_guardrail', 'warn', 'Approaching max steps without diff; exiting as no_patch', {
            iteration: i + 1,
            max_steps: maxSteps,
          });
          noPatchReason = 'max_steps_reached_without_diff';
        }
        stoppedByNoPatchGuardrail = true;
        break;
      }
    }
  }

  return { usage, stepsCompleted, stoppedByNoPatchGuardrail, noPatchReason };
}

async function main(): Promise<void> {
  const started = Date.now();
  try {
    redirectConsoleNoiseToStderr();
    const args = parseArgs(process.argv.slice(2));
    emitRunnerEvent('runner_phase', 'info', 'bootstrap_start', { runner_mode: args.runnerMode });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

    installVscodeShim(args.repoDir);

    const { AgentManager } = await import('../../src/agent/agentManager/AgentManager');
    const codingStandards = await import('../../src/agent/prompts/codingStandards');
    const { OpenRouterService } = await import('../../src/services/OpenRouterService');
    const { TerminalManager } = await import('../../src/terminal/TerminalManager');
    const { RelationshipGraph } = await import('../../src/agent/graph/RelationshipGraph');
    const { GuardianService } = await import('../../src/guardian/GuardianService');
    const { ModeManager } = await import('../../src/modes/ModeManager');
    const { ArchitectMode } = await import('../../src/modes/ArchitectMode');
    const { CodeMode } = await import('../../src/modes/CodeMode');

    const extensionUri = {
      fsPath: path.resolve('.'),
      path: path.resolve('.'),
      toString: () => path.resolve('.'),
    };
    const context: any = {
      extensionUri,
      globalState: {
        _store: new Map<string, any>(),
        get(key: string, def?: any) { return this._store.has(key) ? this._store.get(key) : def; },
        async update(key: string, value: any) { this._store.set(key, value); return undefined; },
      },
      workspaceState: {
        _store: new Map<string, any>(),
        get(key: string, def?: any) { return this._store.has(key) ? this._store.get(key) : def; },
        async update(key: string, value: any) { this._store.set(key, value); return undefined; },
      },
      secrets: {
        _store: new Map<string, string>(),
        async get(key: string) { return this._store.get(key); },
        async store(key: string, value: string) { this._store.set(key, value); },
        async delete(key: string) { this._store.delete(key); },
      },
      subscriptions: [],
    };

    // Ensure VerificationAgent/OpenRouter-aware services resolve with the benchmark model.
    process.env.GENTLY_VERIFICATION_MODEL = args.verificationModel;
    process.env.GENTLY_MODEL = args.model;

    const apiKeyManager = {
      async getKey() { return apiKey; },
      async setKey(_key: string) { return undefined; },
      async deleteKey() { return undefined; },
      async hasKey() { return true; },
    } as any;
    const openRouterService = new OpenRouterService(apiKeyManager);

    const agentManager = new AgentManager(context);
    const internalContainer = (agentManager as any).container;
    if (internalContainer && typeof internalContainer.force === 'function') {
      internalContainer.force('openRouterService', openRouterService);
    }
    await agentManager.initialize();
    emitRunnerEvent('runner_phase', 'success', 'agent_init_done');

    const modeManager = new ModeManager();
    await modeManager.activate();
    modeManager.registerMode(new ArchitectMode());
    modeManager.registerMode(new CodeMode());
    await modeManager.setMode('architect');

    const handoverState = { requested: false, accepted: false, message: '' };
    agentManager.setEventCallback((event: any) => {
      if (event?.type === 'handover_to_coder') {
        handoverState.requested = true;
        handoverState.message = String(event?.message || '');
        emitRunnerEvent('mode_transition', 'info', 'Handover event received', {
          from_mode: 'architect',
          to_mode: 'code',
          reason: 'handover_to_coder',
        });
      }
    });

    // AST / tree-sitter sanity check in full-parity mode.
    if (args.requireTreesitter) {
      const astAnalyzer = internalContainer?.resolve?.('astAnalyzer');
      if (!astAnalyzer || typeof astAnalyzer.initialize !== 'function') {
        throw new Error('treesitter_unavailable: astAnalyzer missing in container');
      }
      await astAnalyzer.initialize();
      emitRunnerEvent('runner_phase', 'success', 'ast_init_done');
    }

    // Headless terminal bridge (run_command + verification support).
    const terminalManager = new TerminalManager(
      context,
      (_message: any) => {
        // No-op in benchmark mode: we do not have a webview.
      }
    );
    // Headless mode has no approval UI, so force auto-confirm for all terminal commands
    // to avoid hanging on pending approval promises.
    const originalExecuteCommand = terminalManager.executeCommand.bind(terminalManager);
    (terminalManager as any).executeCommand = (
      command: string,
      reason: string,
      options: any = {}
    ) => {
      return originalExecuteCommand(command, reason, { ...options, autoConfirm: true });
    };
    agentManager.setTerminalManager(terminalManager);
    emitRunnerEvent('runner_phase', 'success', 'terminal_bridge_done');

    // Guardian/Graph bridge (extension-like parity, without UI integration).
    const workspaceRoot = args.repoDir;
    const memoryManager = agentManager.baseMemoryManager as any;
    const validationManager = agentManager.validationManager as any;
    const codebaseIndexer = internalContainer?.resolve?.('indexer');
    const hybridRetriever = internalContainer?.resolve?.('hybridRetriever');
    if (memoryManager && codebaseIndexer && hybridRetriever) {
      const relationshipGraph = new RelationshipGraph({ workspaceRoot });
      const guardianService = new GuardianService(
        workspaceRoot,
        relationshipGraph,
        memoryManager,
        validationManager,
        hybridRetriever,
        codebaseIndexer,
        {
          autoAnalysis: false,
        } as any
      );
      await guardianService.initialize();
      agentManager.setGuardianService(guardianService);
      emitRunnerEvent('runner_phase', 'success', 'guardian_bridge_done');
    }

    const toolManager = agentManager.getToolManager();
    const initialModeTools = filterFormattedToolsForMode(toolManager.getFormattedTools(), 'architect');
    const initialModeToolNames = initialModeTools
      .map((tool: any) => tool?.function?.name)
      .filter((name: any): name is string => typeof name === 'string');
    emitRunnerEvent('mode_state', 'info', 'Mode state updated', {
      current_mode: 'architect',
      trigger: 'runner_start',
      allowed_tools_count: Array.isArray(initialModeTools) ? initialModeTools.length : undefined,
      allowed_tool_names_sample: initialModeToolNames.slice(0, 10),
    });
    const modeProvider = () => modeManager.getCurrentModeId() || undefined;
    toolManager.setCurrentModeProvider(modeProvider);
    agentManager.setCurrentModeProvider(modeProvider);
    await toolManager.getAutoApproveManager().setSettings({
      version: 1,
      actions: {
        readFiles: true,
        readFilesExternally: true,
        editFiles: true,
        editFilesExternally: true,
        executeSafeCommands: true,
        executeAllCommands: true,
        useBrowser: false,
        useMcp: false,
      },
      enableNotifications: false,
      yoloMode: true,
    });

    const problem = fs.readFileSync(args.problemFile, 'utf8');
    const standards = String(codingStandards.CODING_STANDARDS_PROMPT || '');

    emitRunnerEvent('runner_phase', 'info', 'tool_loop_start');
    const loop = await runToolLoop(args, apiKey, toolManager, modeManager, handoverState, standards, problem);
    emitRunnerEvent('runner_phase', 'success', 'tool_loop_end', { steps_completed: loop.stepsCompleted });

    emitRunnerEvent('runner_phase', 'info', 'patch_extract_start');
    const patch = extractPatch(args.repoDir);
    const validation = validatePatch(args.repoDir, patch);
    emitRunnerEvent('runner_phase', 'success', 'patch_validate_done', { patch_valid: validation.valid });
    const out: RunnerResult = {
      status: validation.valid
        ? 'success'
        : patch.trim()
          ? 'invalid_patch'
          : 'no_patch',
      patch: validation.valid ? patch : '',
      error: validation.valid
        ? null
        : (!patch.trim()
          ? (loop.noPatchReason || (loop.stoppedByNoPatchGuardrail ? 'No effective code diff generated' : 'Empty patch'))
          : (validation.error || 'invalid patch')),
      usage: loop.usage,
      duration_ms: Date.now() - started,
      steps_completed: loop.stepsCompleted,
    };
    emitResult(out);
    setImmediate(() => process.exit(0));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitRunnerEvent('runner_phase', 'error', 'runner_failed', { error: message });
    let status: RunnerStatus = 'infra_error';
    if (message.includes('request_timeout')) {
      status = 'timeout';
    } else if (message.includes('treesitter_')) {
      status = 'infra_error';
    } else if (message.includes('openrouter_http_')) {
      status = 'infra_error';
    }
    const out: RunnerResult = {
      status,
      patch: '',
      error: message,
      usage: null,
      duration_ms: Date.now() - started,
      steps_completed: 0,
    };
    emitResult(out);
    setImmediate(() => process.exit(0));
  }
}

void main();
