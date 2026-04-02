export type PromptVariant = 'default' | 'minimal' | 'detailed';

export type PromptComponentId =
  | 'identity'
  | 'objective'
  | 'mode_contract'
  | 'tool_policy'
  | 'recovery_policy'
  | 'output_contract'
  | 'tooling'
  | 'examples'
  | 'memory'
  | 'runtime_hints'
  | 'rules'
  | 'response_formatting';

export interface PromptVariantConfig {
  variant: PromptVariant;
  components: PromptComponentId[];
  temperature?: number;
  maxTokens?: number;
}

export interface PromptDescriptor {
  id: string;
  mode: string;
  version: string;
  labels: string[];
  defaultVariant: PromptVariant;
  variants: Record<PromptVariant, PromptVariantConfig>;
}

export interface PromptConfig {
  promptId: string;
  variant?: PromptVariant;
  labels?: string[];
  components?: PromptComponentId[];
}

export interface PromptBuilderTool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface PromptContext {
  mode: string;
  model?: string | null;
  familyOverridesEnabled?: boolean;
  promptContractV2Enabled?: boolean;
  workspaceName?: string;
  retryCount?: number;
  memoryBankContext?: string;
  memoriesPrompt?: string;
  conversationSummary?: string;
  tools?: PromptBuilderTool[];
  promptConfig?: PromptConfig;
}

export interface PromptBuildResult {
  prompt: string;
  metadata: {
    promptId: string;
    version: string;
    variant: PromptVariant;
    labels: string[];
    hash: string;
    usedFallback: boolean;
  };
}
