import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './PromptBuilder';

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();
  const tools = [
    {
      name: 'read_file',
      description: 'Read files',
      parameters: { path: { type: 'string' } }
    },
    {
      name: 'create_plan',
      description: 'Create plan',
      parameters: { goal: { type: 'string' } }
    }
  ];

  it('builds architect/default prompt snapshot', () => {
    const result = builder.build({
      mode: 'architect',
      model: 'deepseek/deepseek-chat',
      workspaceName: 'agent',
      tools,
      memoryBankContext: 'MEMORY_BANK',
      memoriesPrompt: 'MEMORIES',
      retryCount: 0
    });

    expect(result.metadata.promptId).toBe('architect-core');
    expect(result.metadata.variant).toBe('default');
    expect(result.prompt).toContain('You are "Gently" in Architect mode');
    expect(result.prompt).toContain('AVAILABLE TOOLS (MINIFIED)');
    expect(result.prompt).toContain('MODE CONTRACT (PLAN_STRICT)');
    expect(result.prompt).toContain('RECOVERY POLICY');
    expect(result.prompt).toContain('OUTPUT CONTRACT');
    expect(result.prompt).toContain('MEMORY_BANK');
    expect(result.prompt).toMatchSnapshot();
  });

  it('builds architect/minimal without memory component', () => {
    const result = builder.build({
      mode: 'architect',
      model: 'deepseek/deepseek-chat',
      workspaceName: 'agent',
      tools,
      memoryBankContext: 'MEMORY_BANK',
      memoriesPrompt: 'MEMORIES',
      promptConfig: {
        promptId: 'architect-core',
        variant: 'minimal'
      }
    });

    expect(result.metadata.variant).toBe('minimal');
    expect(result.prompt).not.toContain('MEMORY_BANK');
    expect(result.prompt).not.toContain('MEMORIES');
    expect(result.prompt).not.toContain('EXAMPLES:');
    expect(result.prompt).toMatchSnapshot();
  });

  it('builds code/default and keeps code-mode rules', () => {
    const result = builder.build({
      mode: 'code',
      model: 'minimax/minimax-m2.7',
      workspaceName: 'agent',
      tools,
      retryCount: 2
    });

    expect(result.metadata.promptId).toBe('code-core');
    expect(result.prompt).toContain('You are "Gently" in Code mode');
    expect(result.prompt).toContain('MODE CONTRACT (ACT_STRICT)');
    expect(result.prompt).toContain('RETRY LEVEL 2');
    expect(result.prompt).toContain('MINIMAX FAMILY OVERRIDE');
    expect(result.prompt).toContain('WICHTIG: Nach Tool-Ausführung IMMER eine klare Antwort geben');
    expect(result.prompt).toMatchSnapshot();
  });

  it('falls back to legacy prompt when descriptor is missing', () => {
    const result = builder.build({
      mode: 'unknown-mode',
      promptConfig: {
        promptId: 'missing'
      }
    }, {
      legacyFallbackPrompt: 'LEGACY_PROMPT'
    });

    expect(result.metadata.usedFallback).toBe(true);
    expect(result.prompt).toBe('LEGACY_PROMPT');
  });

  it('applies family overrides when enabled and skips when disabled', () => {
    const withOverride = builder.build({
      mode: 'code',
      model: 'anthropic/claude-4.6-sonnet',
      tools
    });
    expect(withOverride.prompt).toContain('CLAUDE FAMILY OVERRIDE');

    const withoutOverride = builder.build({
      mode: 'code',
      model: 'anthropic/claude-4.6-sonnet',
      familyOverridesEnabled: false,
      tools
    });
    expect(withoutOverride.prompt).not.toContain('CLAUDE FAMILY OVERRIDE');
  });

  it('fails hard when prompt contract v2 required components are missing', () => {
    expect(() => builder.build({
      mode: 'code',
      promptContractV2Enabled: true,
      promptConfig: {
        promptId: 'code-core',
        components: ['identity', 'objective']
      }
    })).toThrow('Prompt Contract V2: missing required component');
  });
});
