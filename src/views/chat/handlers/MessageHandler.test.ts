import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MessageHandler } from './MessageHandler';
import { ChatViewContext } from '../types/ChatTypes';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() }))
  }
}));

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

describe('MessageHandler.setAvailableModels', () => {
  let globalStateUpdate: ReturnType<typeof vi.fn>;
  let sendMessageToWebview: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    globalStateUpdate = vi.fn().mockResolvedValue(undefined);
    sendMessageToWebview = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps selected model when it is structurally valid but not in refreshed list', () => {
    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext('openai/gpt-4o');
    handler.availableModelIds = new Set<string>();
    handler.extensionContext = {
      globalState: {
        update: globalStateUpdate
      }
    };
    handler.sendMessageToWebview = sendMessageToWebview;
    handler.persistSelectedModelToActiveSession = vi.fn().mockResolvedValue(undefined);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    handler.setAvailableModels([{ id: 'anthropic/claude-3.5-sonnet' }]);

    expect(handler.context.selectedModel).toBe('openai/gpt-4o');
    expect(globalStateUpdate).not.toHaveBeenCalledWith('gently.selectedModel', null);
    expect(sendMessageToWebview).not.toHaveBeenCalledWith({ type: 'modelChanged', model: '' });
    expect(warnSpy).toHaveBeenCalled();
  });

  it('clears selected model when it is structurally invalid', () => {
    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext('deepseek-chat');
    handler.availableModelIds = new Set<string>();
    handler.extensionContext = {
      globalState: {
        update: globalStateUpdate
      }
    };
    handler.sendMessageToWebview = sendMessageToWebview;
    handler.persistSelectedModelToActiveSession = vi.fn().mockResolvedValue(undefined);

    handler.setAvailableModels([{ id: 'openai/gpt-4o' }]);

    expect(handler.context.selectedModel).toBeNull();
    expect(globalStateUpdate).toHaveBeenCalledWith('gently.selectedModel', null);
    expect(sendMessageToWebview).toHaveBeenCalledWith({ type: 'modelChanged', model: '' });
  });
});

describe('MessageHandler mode state loading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prioritizes selectedMode from storage over agentMode config', () => {
    const getConfiguration = vi.mocked(vscode.workspace.getConfiguration);
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'agentMode') return true;
        if (key === 'selectedModel') return '';
        return fallback;
      })
    } as any);

    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext(null);
    handler.extensionContext = {
      globalState: {
        get: vi.fn((key: string, fallback?: unknown) => {
          if (key === 'gently.selectedMode') return 'architect';
          if (key === 'gently.selectedModel') return null;
          return fallback;
        })
      }
    };

    handler.loadStoredState();

    expect(handler.context.selectedMode).toBe('architect');
    expect(handler.context.agentMode).toBe(false);
  });

  it('falls back to agentMode when selectedMode is not stored', () => {
    const getConfiguration = vi.mocked(vscode.workspace.getConfiguration);
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'agentMode') return true;
        if (key === 'selectedModel') return '';
        return fallback;
      })
    } as any);

    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext(null);
    handler.extensionContext = {
      globalState: {
        get: vi.fn((key: string, fallback?: unknown) => {
          if (key === 'gently.selectedMode') return null;
          if (key === 'gently.selectedModel') return null;
          return fallback;
        })
      }
    };

    handler.loadStoredState();

    expect(handler.context.selectedMode).toBe('code');
    expect(handler.context.agentMode).toBe(true);
  });
});

describe('MessageHandler stop/continuation hardening', () => {
  it('blocks continuation messages when stop is active', async () => {
    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext('openai/gpt-4o');
    handler.context.shouldStopStream = true;
    handler.context.shouldAbortTools = true;
    handler.context.currentFlowId = 'flow-stop';
    handler.isValidOpenRouterModelId = vi.fn(() => true);
    handler.sendMessageToWebview = vi.fn();
    handler.flowManager = {
      handleUserMessage: vi.fn()
    };

    await handler.sendMessage('continue', false, undefined, 0, 'continuation');

    expect(handler.flowManager.handleUserMessage).not.toHaveBeenCalled();
    expect(handler.sendMessageToWebview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resilienceStatus',
        code: 'REQUEST_STOPPED'
      })
    );
  });

  it('emits stopAcknowledged and aborts active run controller', async () => {
    const abort = vi.fn();
    const handler = Object.create(MessageHandler.prototype) as any;
    handler.context = createContext('openai/gpt-4o');
    handler.context.currentFlowId = 'flow-stop-ack';
    handler.context.currentRunId = 'run-1';
    handler.context.currentMessageId = 'msg-1';
    handler.context.activeRunAbortController = { abort };
    handler.agentManager = {
      getToolManager: vi.fn(() => ({
        abortAllExecutions: vi.fn().mockResolvedValue(undefined)
      }))
    };
    handler.guardedSendMessageToWebview = vi.fn();

    await handler.stopMessage('REQUEST_STOPPED');

    expect(abort).toHaveBeenCalledWith('REQUEST_STOPPED');
    expect(handler.guardedSendMessageToWebview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stopAcknowledged',
        flowId: 'flow-stop-ack',
        runId: 'run-1',
        reasonCode: 'REQUEST_STOPPED'
      })
    );
  });
});
