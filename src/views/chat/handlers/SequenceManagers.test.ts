import { describe, expect, it, vi } from 'vitest';
import { FollowUpHandler } from './SequenceManagers';
import { ChatViewContext } from '../types/ChatTypes';

vi.mock('vscode', () => ({}));

function createContext(selectedModel: string | null): ChatViewContext {
  return {
    agentMode: false,
    selectedModel,
    selectedMode: 'ask',
    conversationHistory: [],
    shouldStopStream: false,
    shouldAbortTools: false,
    messageCheckpoints: new Map(),
    toolExecutionStartSent: new Set()
  };
}

describe('FollowUpHandler.sendFollowUpMessage', () => {
  it('aborts with explicit error when model is missing and recovery fails', async () => {
    const sendMessageToWebview = vi.fn();
    const generateAndStreamResponse = vi.fn();
    const recoverSelectedModel = vi.fn().mockResolvedValue(null);

    const handler = new FollowUpHandler(
      {} as any,
      sendMessageToWebview,
      () => ({ valid: true, issues: [] }),
      (messages) => ({ repaired: false, messages, fixes: [] }),
      generateAndStreamResponse,
      recoverSelectedModel
    );

    const context = createContext(null);
    await handler.sendFollowUpMessage(context, '');

    expect(recoverSelectedModel).toHaveBeenCalled();
    expect(generateAndStreamResponse).not.toHaveBeenCalled();
    expect(sendMessageToWebview).toHaveBeenCalledWith({
      type: 'error',
      message: 'Model selection was lost. Please re-select a model.'
    });
  });

  it('recovers model and continues follow-up when recovery succeeds', async () => {
    const sendMessageToWebview = vi.fn();
    const generateAndStreamResponse = vi.fn().mockResolvedValue(undefined);
    const recoverSelectedModel = vi.fn().mockResolvedValue('openai/gpt-4o');

    const handler = new FollowUpHandler(
      {} as any,
      sendMessageToWebview,
      () => ({ valid: true, issues: [] }),
      (messages) => ({ repaired: false, messages, fixes: [] }),
      generateAndStreamResponse,
      recoverSelectedModel
    );

    const context = createContext(null);
    await handler.sendFollowUpMessage(context, '');

    expect(context.selectedModel).toBe('openai/gpt-4o');
    expect(generateAndStreamResponse).toHaveBeenCalledWith('', 0, true);
  });

  it('continues follow-up immediately when model exists', async () => {
    const sendMessageToWebview = vi.fn();
    const generateAndStreamResponse = vi.fn().mockResolvedValue(undefined);
    const recoverSelectedModel = vi.fn();

    const handler = new FollowUpHandler(
      {} as any,
      sendMessageToWebview,
      () => ({ valid: true, issues: [] }),
      (messages) => ({ repaired: false, messages, fixes: [] }),
      generateAndStreamResponse,
      recoverSelectedModel
    );

    const context = createContext('openai/gpt-4o');
    await handler.sendFollowUpMessage(context, '');

    expect(recoverSelectedModel).not.toHaveBeenCalled();
    expect(generateAndStreamResponse).toHaveBeenCalledWith('', 0, true);
  });
});

