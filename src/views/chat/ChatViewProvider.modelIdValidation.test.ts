import { describe, expect, it, vi } from 'vitest';
import { ChatViewProvider } from './ChatViewProvider';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1
  }
}));

describe('ChatViewProvider model id validation', () => {
  it('accepts uppercase and common slug symbols in provider/model segments', () => {
    const provider = Object.create(ChatViewProvider.prototype) as any;

    expect(provider.isStructurallyValidModelId('OpenAI/GPT-4.1-Mini')).toBe(true);
    expect(provider.isStructurallyValidModelId('anthropic/Claude-3.7-Sonnet:thinking+beta@2026')).toBe(true);
  });

  it('rejects ids without provider/model structure or with whitespace', () => {
    const provider = Object.create(ChatViewProvider.prototype) as any;

    expect(provider.isStructurallyValidModelId('openai')).toBe(false);
    expect(provider.isStructurallyValidModelId('openai/')).toBe(false);
    expect(provider.isStructurallyValidModelId('open ai/gpt-4.1')).toBe(false);
    expect(provider.isStructurallyValidModelId('openai/gpt 4.1')).toBe(false);
  });
});
