import { createHash } from 'crypto';
import { RESPONSE_FORMATTING_PROMPT } from './responseFormatting';
import { PromptRegistry } from './PromptRegistry';
import { TemplateEngine } from './TemplateEngine';
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

    const blocks = this.registry.getTextBlocks(context.mode);
    const toolBlock = this.renderTools(context.tools || []);
    const providerSafety = this.renderProviderSafetyClause(context.model || '');
    const retryHint = context.retryCount && context.retryCount > 0
      ? `\n\nRETRY ATTEMPT ${context.retryCount}/3 - CRITICAL:\nEnsure that all tool_calls have VALID JSON arguments. Use double quotes, escape special characters, and close all brackets.`
      : '';
    const summaryBlock = context.conversationSummary
      ? `\n\n--- PREVIOUS CONVERSATION SUMMARY ---\n${context.conversationSummary}\n-----------------------------------`
      : '';

    const templateValues = {
      identity: blocks.identity,
      objective: blocks.objective,
      rules: blocks.rules,
      tooling: toolBlock,
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
      case 'rules':
        return this.templateEngine.render('{{rules}}', values, { mode });
      case 'tooling':
        return this.templateEngine.render('AVAILABLE TOOLS (MINIFIED):\n{{tooling}}', values, { mode });
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
