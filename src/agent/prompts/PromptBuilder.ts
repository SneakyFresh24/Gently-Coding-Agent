import { createHash } from 'crypto';
import { RESPONSE_FORMATTING_PROMPT } from './responseFormatting';
import { PromptRegistry } from './PromptRegistry';
import { TemplateEngine } from './TemplateEngine';
import { applyFamilyOverrides, getFamilyOverrideSpec } from './families';
import {
  PromptBuildResult,
  PromptBuilderTool,
  PromptComponentId,
  PromptContext,
  PromptVariantConfig
} from './types';

type BuildOptions = {
  strictTemplates?: boolean;
  legacyFallbackPrompt?: string;
};

function buildProgressivePromptRetryHint(retryCount: number): string {
  if (retryCount <= 0) return '';
  if (retryCount === 1) {
    return 'RETRY LEVEL 1: The previous tool call failed. Check your parameters and try again.';
  }
  if (retryCount === 2) {
    return 'RETRY LEVEL 2: This is your 2nd failed attempt. You MUST use a different approach.';
  }
  return 'RETRY LEVEL 3+: CRITICAL. STOP retrying the same approach. Use alternatives only, or report the issue to the user.';
}

const CONTRACT_V2_REQUIRED_COMPONENTS: PromptComponentId[] = [
  'identity',
  'objective',
  'mode_contract',
  'tool_policy',
  'recovery_policy',
  'output_contract',
  'runtime_hints'
];

const KNOWN_COMPONENTS = new Set<PromptComponentId>([
  'identity',
  'objective',
  'mode_contract',
  'tool_policy',
  'recovery_policy',
  'output_contract',
  'rules',
  'tooling',
  'examples',
  'memory',
  'runtime_hints',
  'response_formatting'
]);

export class PromptBuilder {
  constructor(
    private readonly templateEngine = new TemplateEngine(),
    private readonly registry = new PromptRegistry()
  ) { }

  build(context: PromptContext, options: BuildOptions = {}): PromptBuildResult {
    const descriptor = this.registry.resolve(context.mode, context.promptConfig?.promptId);
    if (!descriptor) {
      if (!options.legacyFallbackPrompt) {
        throw new Error(`No prompt descriptor found for mode "${context.mode}"`);
      }
      return this.buildFallback(context, options.legacyFallbackPrompt);
    }

    const requestedVariant = context.promptConfig?.variant;
    const variant = descriptor.variants[requestedVariant || descriptor.defaultVariant];
    const components = context.promptConfig?.components && context.promptConfig.components.length > 0
      ? context.promptConfig.components
      : variant.components;
    const promptContractV2Enabled = context.promptContractV2Enabled !== false;
    if (promptContractV2Enabled) {
      this.validatePromptContractV2Components(components);
    }

    const baseBlocks = this.registry.getTextBlocks(context.mode);
    const familyOverridesEnabled = context.familyOverridesEnabled !== false;
    const blocks = this.resolveTextBlocks(baseBlocks, context.model, familyOverridesEnabled, promptContractV2Enabled);
    const toolBlock = this.renderTools(context.tools || []);
    const providerSafety = this.renderProviderSafetyClause(context.model || '');
    const retryHint = context.retryCount && context.retryCount > 0
      ? `\n\n${buildProgressivePromptRetryHint(context.retryCount)}`
      : '';
    const summaryBlock = context.conversationSummary
      ? `\n\n--- PREVIOUS CONVERSATION SUMMARY ---\n${context.conversationSummary}\n-----------------------------------`
      : '';

    const templateValues = {
      identity: blocks.identity,
      objective: blocks.objective,
      mode_contract: blocks.modeContract,
      tool_policy: blocks.toolPolicy,
      recovery_policy: blocks.recoveryPolicy,
      output_contract: blocks.outputContract,
      rules: blocks.rules,
      tooling: toolBlock,
      examples: blocks.examples,
      memory_bank: context.memoryBankContext || '',
      memories_prompt: context.memoriesPrompt || '',
      runtime_hints: `${blocks.runtimeHints}${providerSafety}${retryHint}${summaryBlock}`,
      response_formatting: RESPONSE_FORMATTING_PROMPT,
      workspace_name: context.workspaceName || 'No workspace open'
    };

    const prompt = components
      .map(component => this.renderComponent(component, variant, templateValues, options.strictTemplates === true))
      .filter(Boolean)
      .join('\n\n')
      .trim();

    return {
      prompt,
      metadata: {
        promptId: descriptor.id,
        version: descriptor.version,
        variant: variant.variant,
        labels: descriptor.labels,
        hash: createHash('sha256').update(prompt).digest('hex').slice(0, 16),
        usedFallback: false
      }
    };
  }

  private resolveTextBlocks(
    baseBlocks: ReturnType<PromptRegistry['getTextBlocks']>,
    model: string | null | undefined,
    familyOverridesEnabled: boolean,
    validateSpec: boolean
  ) {
    if (!familyOverridesEnabled) {
      return baseBlocks;
    }
    try {
      const overrideSpec = getFamilyOverrideSpec(model);
      return applyFamilyOverrides(baseBlocks, overrideSpec, { validateSpec });
    } catch {
      if (validateSpec) {
        throw new Error('Prompt Contract V2: family override validation failed.');
      }
      return baseBlocks;
    }
  }

  private buildFallback(context: PromptContext, fallbackPrompt: string): PromptBuildResult {
    return {
      prompt: fallbackPrompt,
      metadata: {
        promptId: `${context.mode}-legacy`,
        version: 'legacy',
        variant: 'default',
        labels: ['legacy', 'fallback'],
        hash: createHash('sha256').update(fallbackPrompt).digest('hex').slice(0, 16),
        usedFallback: true
      }
    };
  }

  private renderComponent(
    component: PromptComponentId,
    variant: PromptVariantConfig,
    values: Record<string, string>,
    strictTemplates: boolean
  ): string {
    const mode = strictTemplates ? 'strict' : 'warn';
    switch (component) {
      case 'identity':
        return this.templateEngine.render('{{identity}}', values, { mode });
      case 'objective':
        return this.templateEngine.render('{{objective}}', values, { mode });
      case 'mode_contract':
        return this.templateEngine.render('{{mode_contract}}', values, { mode });
      case 'tool_policy':
        return this.templateEngine.render('{{tool_policy}}', values, { mode });
      case 'recovery_policy':
        return this.templateEngine.render('{{recovery_policy}}', values, { mode });
      case 'output_contract':
        return this.templateEngine.render('{{output_contract}}', values, { mode });
      case 'rules':
        return this.templateEngine.render('{{rules}}', values, { mode });
      case 'tooling':
        return this.templateEngine.render('AVAILABLE TOOLS (MINIFIED):\n{{tooling}}', values, { mode });
      case 'examples':
        return this.templateEngine.render('{{examples}}', values, { mode });
      case 'memory':
        if (variant.variant === 'minimal') {
          return '';
        }
        return this.templateEngine.render('{{memory_bank}}{{memories_prompt}}', values, { mode });
      case 'runtime_hints':
        return this.templateEngine.render('{{runtime_hints}}', values, { mode });
      case 'response_formatting':
        return this.templateEngine.render('{{response_formatting}}', values, { mode });
      default:
        return '';
    }
  }

  private validatePromptContractV2Components(components: PromptComponentId[]): void {
    for (const component of components) {
      if (!KNOWN_COMPONENTS.has(component)) {
        throw new Error(`Prompt Contract V2: unknown component "${component}"`);
      }
    }
    for (const required of CONTRACT_V2_REQUIRED_COMPONENTS) {
      if (!components.includes(required)) {
        throw new Error(`Prompt Contract V2: missing required component "${required}"`);
      }
    }
  }

  private renderTools(tools: PromptBuilderTool[]): string {
    if (!tools.length) {
      return '- No tools available for this mode.';
    }

    const maxTools = 18;
    return tools.slice(0, maxTools).map(tool => {
      const props = tool.parameters && typeof tool.parameters === 'object'
        ? Object.keys(tool.parameters).slice(0, 8).join(', ')
        : '';
      const suffix = props ? ` | params: ${props}` : '';
      return `- ${tool.name}: ${tool.description || 'No description'}${suffix}`;
    }).join('\n');
  }

  private renderProviderSafetyClause(model: string): string {
    const modelLower = model.toLowerCase();
    if (modelLower.includes('minimax') || modelLower.includes('m2.5') || modelLower.includes('glm')) {
      return '\n\nWICHTIG: Nach Tool-Ausführung IMMER eine klare Antwort geben – niemals leer lassen.';
    }
    return '';
  }
}
