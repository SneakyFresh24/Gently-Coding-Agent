import { PromptDescriptor, PromptVariant, PromptVariantConfig } from './types';

const ARCHITECT_IDENTITY = `You are "Gently" in Architect mode. Your primary goal is high-level system design and deterministic implementation planning.`;
const ARCHITECT_OBJECTIVE = `WORKFLOW:
1. ANALYZE: Gather required codebase context with read/analyze tools.
2. PLAN: Persist plan via create_plan with explicit ordered steps.
3. WAIT: If plan status is awaiting_approval, stop tool execution and wait for explicit user approval/rejection.
4. ALIGN: Ask focused follow-up only when ambiguity blocks safe planning.
5. HANDOVER: Switch to code mode only through the handover pipeline after explicit plan approval (handover_to_coder or approved-plan auto-handover gate).`;

const ARCHITECT_MODE_CONTRACT = `MODE CONTRACT (PLAN_STRICT):
- Allowed classes: read/analyze/plan/question/memory tools.
- Forbidden: file mutation, command execution, destructive actions.
- You are not allowed to implement code in this mode.`;

const CODE_IDENTITY = `You are "Gently" in Code mode. Your goal is to implement the approved plan deterministically.`;
const CODE_OBJECTIVE = `WORKFLOW:
1. READ PLAN: Follow architect plan from conversation context.
2. EXECUTE + TRACK: Execute changes in small verifiable steps and keep step status deterministic with update_plan_steps.
3. VERIFY: Re-check edits and summarize outcomes and residual risk.`;

const CODE_MODE_CONTRACT = `MODE CONTRACT (ACT_STRICT):
- Allowed classes: implementation and verification tools.
- Forbidden planning tools: create_plan, handover_to_coder, ask_question.
- update_plan_steps is allowed for deterministic progress tracking.
- Do not re-plan unless user explicitly switches back to architect mode.`;

const SHARED_TOOL_POLICY = `TOOL POLICY:
- Tool-first execution: short intent sentence, then tool calls.
- Independent operations may run in one parallel block; dependent calls stay sequential.
- Always read target files before editing.
- Do not retry identical failed payloads more than two times.`;

const SHARED_RECOVERY_POLICY = `RECOVERY POLICY:
- Retry order is deterministic: context -> sequence -> empty -> rate_limit.
- Retry only when state changed or delay/backoff is explicitly scheduled.
- Stop request immediately when user stop signal is present.
- If retries are exhausted, emit terminal error with stable code and action.`;

const SHARED_OUTPUT_CONTRACT = `OUTPUT CONTRACT:
- Keep normal status text concise and code-based.
- Avoid decorative formatting and long prose.
- Surface one clear action when failure is terminal (retry/switch_model/new_chat/check_privacy_settings).`;

const SHARED_EXAMPLES = `EXAMPLES:
1) Dependent sequence: read_file -> apply_block_edit.
2) Parallel read batch: read_file(a) + read_file(b) in one function_calls block.
3) Recovery: after second identical failure, switch strategy immediately.`;

const SHARED_RUNTIME_HINTS = `RUNTIME HINTS:
- Keep tool payloads complete and valid JSON.
- Place path/file_path before content/new_content for file-writing tools.
- Large writes are auto-chunked by the runtime write pipeline when needed.`;

export type PromptTextBlocks = {
  identity: string;
  objective: string;
  modeContract: string;
  toolPolicy: string;
  recoveryPolicy: string;
  outputContract: string;
  examples: string;
  runtimeHints: string;
  rules: string;
};

const PROMPT_TEXT_BY_MODE: Record<string, PromptTextBlocks> = {
  architect: {
    identity: ARCHITECT_IDENTITY,
    objective: ARCHITECT_OBJECTIVE,
    modeContract: ARCHITECT_MODE_CONTRACT,
    toolPolicy: SHARED_TOOL_POLICY,
    recoveryPolicy: SHARED_RECOVERY_POLICY,
    outputContract: SHARED_OUTPUT_CONTRACT,
    examples: SHARED_EXAMPLES,
    runtimeHints: SHARED_RUNTIME_HINTS,
    // Legacy bridge for older component references.
    rules: `${ARCHITECT_MODE_CONTRACT}\n${SHARED_TOOL_POLICY}`
  },
  code: {
    identity: CODE_IDENTITY,
    objective: CODE_OBJECTIVE,
    modeContract: CODE_MODE_CONTRACT,
    toolPolicy: SHARED_TOOL_POLICY,
    recoveryPolicy: SHARED_RECOVERY_POLICY,
    outputContract: SHARED_OUTPUT_CONTRACT,
    examples: SHARED_EXAMPLES,
    runtimeHints: SHARED_RUNTIME_HINTS,
    // Legacy bridge for older component references.
    rules: `${CODE_MODE_CONTRACT}\n${SHARED_TOOL_POLICY}`
  }
};

function createVariants(baseComponents: PromptVariantConfig['components']): Record<PromptVariant, PromptVariantConfig> {
  return {
    default: {
      variant: 'default',
      components: baseComponents
    },
    minimal: {
      variant: 'minimal',
      components: baseComponents.filter((component) => component !== 'memory' && component !== 'examples')
    },
    detailed: {
      variant: 'detailed',
      components: baseComponents
    }
  };
}

const V2_BASE_COMPONENTS: PromptVariantConfig['components'] = [
  'identity',
  'objective',
  'mode_contract',
  'tool_policy',
  'recovery_policy',
  'output_contract',
  'tooling',
  'examples',
  'memory',
  'runtime_hints'
];

export class PromptRegistry {
  private readonly descriptors = new Map<string, PromptDescriptor>([
    ['architect-core', {
      id: 'architect-core',
      mode: 'architect',
      version: 'v2.0.0',
      labels: ['stable', 'contract-v2'],
      defaultVariant: 'default',
      variants: createVariants(V2_BASE_COMPONENTS)
    }],
    ['code-core', {
      id: 'code-core',
      mode: 'code',
      version: 'v2.0.0',
      labels: ['stable', 'contract-v2'],
      defaultVariant: 'default',
      variants: createVariants(V2_BASE_COMPONENTS)
    }]
  ]);

  get(promptId: string): PromptDescriptor | undefined {
    return this.descriptors.get(promptId);
  }

  resolve(mode: string, promptId?: string): PromptDescriptor | undefined {
    if (promptId) {
      return this.get(promptId);
    }
    return Array.from(this.descriptors.values()).find((descriptor) => descriptor.mode === mode);
  }

  getTextBlocks(mode: string): PromptTextBlocks {
    return PROMPT_TEXT_BY_MODE[mode] || PROMPT_TEXT_BY_MODE.architect;
  }
}
