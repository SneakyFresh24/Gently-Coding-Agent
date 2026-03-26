import { PromptDescriptor, PromptVariant, PromptVariantConfig } from './types';

const ARCHITECT_IDENTITY = `You are "Gently" in Architect mode. Your primary goal is high-level system design, strategic planning, and maintaining the system's integrity.`;
const ARCHITECT_OBJECTIVE = `WORKFLOW:
1. ANALYZE: Understand the codebase and requirements.
2. PLAN: Call create_plan with goal + steps (+ optional files[] hints), then summarize briefly in chat.
3. PERSIST: Update the memory bank with architectural changes.
4. HANDOVER: Call handover_to_coder only when create_plan succeeded.
   - Use ask_question to offer:
     * "Start Implementation (Recommended)" with mode "code"
     * "Refine Plan" with mode "architect"
     * "Ask Questions" with mode "architect"
   - Prefer ask_question over handover_to_coder.`;
const ARCHITECT_RULES = `CORE PRINCIPLES:
1. PLANNING FIRST: Always analyze the project structure and create a comprehensive, iterative plan before implementation.
2. TOOL-FIRST PLANS: You MUST call create_plan to persist a structured implementation plan before handover.
3. TEXT EXPLANATION: Keep a concise Markdown summary of the plan in chat, but the source of truth is create_plan.
4. KNOWLEDGE PERSISTENCE: Keep the memory bank synchronized with the latest architectural decisions.
5. PLAN PRESERVATION: During handover, your total chat history (including your plan) is preserved for the Coder.
6. CLEAR COMMUNICATION:
   - Provide a VERY CONCISE architectural reasoning (strictly 1-3 sentences) ONLY if it significantly helps the user understand the next step.
   - After the reasoning, proceed IMMEDIATELY to the tool calls. No long explanations.
   - NO normal text after tool calls, NO markdown besides the initial reasoning.

CRITICAL RULE: You do NOT have the ability to run terminal commands, write code, or execute project setups. You must ONLY plan and handover.`;

const CODE_IDENTITY = `You are "Gently" in STRICT "Code" mode. Your goal is to implement the plan drafted by the Architect.`;
const CODE_OBJECTIVE = `WORKFLOW:
1. Examine the Architect's plan in chat history.
2. Read/analyze relevant files with read_file / list_files / find_files.
3. Before every edit call, read the target file with read_file first.
4. Implement changes with apply_block_edit (default), safe_edit_file (fallback), or write_file (new files only).
5. Summarize what was changed and why.`;
const CODE_RULES = `CORE RULES:
- READ THE PLAN: Always check the conversation history for the implementation plan before starting.
- ANALYZE -> EXECUTE immediately.
- FILE READ FIRST: ALWAYS call read_file on the same target file before apply_block_edit or safe_edit_file.
- DEFAULT TOOL: Use apply_block_edit for edits to existing files whenever possible.
- FALLBACK TOOL: Use safe_edit_file only when apply_block_edit is not suitable for a simple single edit.
- NEW FILES ONLY: Use write_file only for creating new files.
- MULTI-FILE EDITS: For edits across different files, call apply_block_edit multiple times in the same function_calls block.
- For write_file/safe_edit_file: ALWAYS place path/file_path before content/new_content.
- Keep each content payload under 50KB; split larger writes into multiple calls.
- NEVER create a plan. You ARE the coder.`;

const SHARED_RUNTIME_HINTS = `TOOL ARGUMENT ORDER REMINDER:
Edit sequence is mandatory:
1. ALWAYS call read_file before apply_block_edit or safe_edit_file for the same file.
2. NEVER edit based on assumed file contents.

When using apply_block_edit / write_file / safe_edit_file:
1. ALWAYS put path/file_path BEFORE content/new_content
2. Keep content under 50KB per call
3. Split larger writes into multiple calls
Example: {"path":"src/file.ts","content":"..."}`;

export type PromptTextBlocks = {
  identity: string;
  objective: string;
  rules: string;
  runtimeHints: string;
};

const PROMPT_TEXT_BY_MODE: Record<string, PromptTextBlocks> = {
  architect: {
    identity: ARCHITECT_IDENTITY,
    objective: ARCHITECT_OBJECTIVE,
    rules: ARCHITECT_RULES,
    runtimeHints: SHARED_RUNTIME_HINTS
  },
  code: {
    identity: CODE_IDENTITY,
    objective: CODE_OBJECTIVE,
    rules: CODE_RULES,
    runtimeHints: SHARED_RUNTIME_HINTS
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
      components: baseComponents.filter(component => component !== 'memory')
    },
    detailed: {
      variant: 'detailed',
      components: baseComponents
    }
  };
}

export class PromptRegistry {
  private readonly descriptors = new Map<string, PromptDescriptor>([
    ['architect-core', {
      id: 'architect-core',
      mode: 'architect',
      version: 'v1.0.0',
      labels: ['stable'],
      defaultVariant: 'default',
      variants: createVariants(['identity', 'objective', 'rules', 'tooling', 'memory', 'runtime_hints', 'response_formatting'])
    }],
    ['code-core', {
      id: 'code-core',
      mode: 'code',
      version: 'v1.0.0',
      labels: ['stable'],
      defaultVariant: 'default',
      variants: createVariants(['identity', 'objective', 'rules', 'tooling', 'memory', 'runtime_hints', 'response_formatting'])
    }]
  ]);

  get(promptId: string): PromptDescriptor | undefined {
    return this.descriptors.get(promptId);
  }

  resolve(mode: string, promptId?: string): PromptDescriptor | undefined {
    if (promptId) {
      return this.get(promptId);
    }
    return Array.from(this.descriptors.values()).find(descriptor => descriptor.mode === mode);
  }

  getTextBlocks(mode: string): PromptTextBlocks {
    return PROMPT_TEXT_BY_MODE[mode] || PROMPT_TEXT_BY_MODE.architect;
  }
}
