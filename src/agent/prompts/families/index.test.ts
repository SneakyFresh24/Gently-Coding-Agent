import { describe, expect, it } from 'vitest';
import type { PromptTextBlocks } from '../PromptRegistry';
import { applyFamilyOverrides, detectPromptFamily, getFamilyOverrideSpec } from './index';

const BASE_BLOCKS: PromptTextBlocks = {
  identity: 'IDENTITY',
  objective: 'OBJECTIVE',
  rules: 'BASE_RULES',
  examples: 'BASE_EXAMPLES',
  runtimeHints: 'BASE_HINTS'
};

describe('prompt family resolver', () => {
  it('maps known models to supported prompt families', () => {
    expect(detectPromptFamily('anthropic/claude-4.6-sonnet')).toBe('claude');
    expect(detectPromptFamily('openai/gpt-5')).toBe('gpt');
    expect(detectPromptFamily('google/gemini-2.5-pro')).toBe('gemini');
    expect(detectPromptFamily('minimax/minimax-m2.7')).toBe('minimax');
    expect(detectPromptFamily('zhipu/glm-4.6')).toBe('glm');
    expect(detectPromptFamily('xai/grok-4-beta')).toBe('grok');
  });

  it('falls back to unknown family for unsupported models', () => {
    expect(detectPromptFamily('some-new-model')).toBe('unknown');
    expect(getFamilyOverrideSpec('some-new-model').overrides).toHaveLength(0);
  });
});

describe('family override merge', () => {
  it('supports append, prepend and replace strategies deterministically', () => {
    const merged = applyFamilyOverrides(BASE_BLOCKS, {
      family: 'unknown',
      overrides: [
        { component: 'rules', strategy: 'append', content: 'APPEND_1' },
        { component: 'rules', strategy: 'prepend', content: 'PREPEND_1' },
        { component: 'rules', strategy: 'replace', content: 'REPLACE_1' },
        { component: 'rules', strategy: 'append', content: 'APPEND_2' }
      ]
    });

    expect(merged.rules).toBe('REPLACE_1\nAPPEND_2');
  });

  it('ignores unsupported components for prompt text blocks', () => {
    const merged = applyFamilyOverrides(BASE_BLOCKS, {
      family: 'unknown',
      overrides: [
        { component: 'tooling', strategy: 'append', content: 'SHOULD_NOT_APPEAR' }
      ]
    });
    expect(merged.rules).toBe('BASE_RULES');
    expect(merged.examples).toBe('BASE_EXAMPLES');
  });
});
