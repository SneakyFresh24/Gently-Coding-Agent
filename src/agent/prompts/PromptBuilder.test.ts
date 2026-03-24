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
    expect(result.prompt).toContain('STRICT "Code" mode');
    expect(result.prompt).toContain('NEVER create a plan');
    expect(result.prompt).toContain('RETRY ATTEMPT 2/3');
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
});

