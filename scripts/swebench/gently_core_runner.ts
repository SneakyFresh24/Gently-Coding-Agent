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
}

let resultWritten = false;

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
  standards: string,
  problemRaw: string
): Promise<{ usage: { input_tokens: number; output_tokens: number; total_tokens: number }; stepsCompleted: number }> {
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
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };

  for (let i = 0; i < maxSteps; i++) {
    const payload = {
      model: args.model,
      temperature: args.temperature,
      max_tokens: effectiveMaxTokens,
      messages,
      tools,
      tool_choice: 'auto',
    };

    const response = await postJson(payload, apiKey, args.timeoutSec * 1000);
    if (response.statusCode !== 200) {
      throw new Error(`openrouter_http_${response.statusCode}: ${response.body}`);
    }

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

      const result = await toolManager.executeTool(name, parsedArgs);
      stepsCompleted += 1;
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { usage, stepsCompleted };
}

async function main(): Promise<void> {
  const started = Date.now();
  try {
    redirectConsoleNoiseToStderr();
    const args = parseArgs(process.argv.slice(2));
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required');

    installVscodeShim(args.repoDir);

    const { AgentManager } = await import('../../src/agent/agentManager/AgentManager');
    const codingStandards = await import('../../src/agent/prompts/codingStandards');
    const { OpenRouterService } = await import('../../src/services/OpenRouterService');
    const { TerminalManager } = await import('../../src/terminal/TerminalManager');
    const { RelationshipGraph } = await import('../../src/agent/graph/RelationshipGraph');
    const { GuardianService } = await import('../../src/guardian/GuardianService');

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

    // AST / tree-sitter sanity check in full-parity mode.
    if (args.requireTreesitter) {
      const astAnalyzer = internalContainer?.resolve?.('astAnalyzer');
      if (!astAnalyzer || typeof astAnalyzer.initialize !== 'function') {
        throw new Error('treesitter_unavailable: astAnalyzer missing in container');
      }
      await astAnalyzer.initialize();
    }

    // Headless terminal bridge (run_command + verification support).
    const terminalManager = new TerminalManager(
      context,
      (_message: any) => {
        // No-op in benchmark mode: we do not have a webview.
      }
    );
    agentManager.setTerminalManager(terminalManager);

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
    }

    const toolManager = agentManager.getToolManager();
    toolManager.setCurrentModeProvider(() => 'agent');
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

    const loop = await runToolLoop(args, apiKey, toolManager, standards, problem);

    const patch = extractPatch(args.repoDir);
    const validation = validatePatch(args.repoDir, patch);
    const out: RunnerResult = {
      status: validation.valid ? 'success' : patch.trim() ? 'invalid_patch' : 'no_patch',
      patch: validation.valid ? patch : '',
      error: validation.valid ? null : validation.error || 'invalid patch',
      usage: loop.usage,
      duration_ms: Date.now() - started,
      steps_completed: loop.stepsCompleted,
    };
    emitResult(out);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  }
}

void main();
