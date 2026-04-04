import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatViewProvider } from './ChatViewProvider';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
    workspaceFolders: []
  },
  commands: {
    executeCommand: vi.fn()
  },
  window: {
    showErrorMessage: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1
  }
}));

type WebviewMessageCallback = (data: any) => Promise<void>;

function createHarness(options?: {
  toolManagerHandle?: (questionId: string, selectedOptionIndexes: number[], source: 'user' | 'stopped') => void;
}) {
  const onQuestionResponse = vi.fn(
    options?.toolManagerHandle ||
      ((_questionId: string, _selectedOptionIndexes: number[], _source: 'user' | 'stopped') => {})
  );
  const toolManager = {
    handleQuestionResponse: onQuestionResponse
  };

  const provider = Object.create(ChatViewProvider.prototype) as any;
  provider.pendingMessages = [];
  provider.isWebviewReady = false;
  provider.modeService = {
    getCurrentMode: vi.fn(() => ({
      id: 'architect',
      displayName: 'Architect',
      description: 'Planning mode'
    }))
  };
  provider.agentManager = {
    getToolManager: vi.fn(() => toolManager)
  };
  provider.messageHandler = {
    getContext: vi.fn(() => ({
      selectedMode: 'architect',
      selectedModel: 'qwen/qwen3.6-plus:free',
      currentFlowId: 'flow-question-integration'
    }))
  };
  provider.webviewMessageHandler = {
    handleMessage: vi.fn().mockResolvedValue(undefined)
  };
  provider.initializeWebviewData = vi.fn().mockResolvedValue(undefined);
  provider.setSelectedMode = vi.fn().mockResolvedValue(undefined);
  provider.handleCommandApprovalResponse = vi.fn().mockResolvedValue(undefined);
  provider.sendMessageToWebview = vi.fn();
  provider._getHtmlForWebview = vi.fn(() => '<html></html>');

  let onDidReceiveMessageCallback: WebviewMessageCallback | undefined;
  const webviewView = {
    webview: {
      options: {},
      html: '',
      postMessage: vi.fn(),
      onDidReceiveMessage: vi.fn((callback: WebviewMessageCallback) => {
        onDidReceiveMessageCallback = callback;
      })
    }
  };

  provider.resolveWebviewView(webviewView as any, {} as any, {} as any);

  if (!onDidReceiveMessageCallback) {
    throw new Error('onDidReceiveMessage callback was not registered');
  }

  return {
    provider,
    onQuestionResponse,
    dispatchMessage: onDidReceiveMessageCallback
  };
}

describe('ChatViewProvider questionResponse integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('routes questionResponse through provider to ToolManager with normalized payload', async () => {
    const { dispatchMessage, onQuestionResponse, provider } = createHarness();

    await dispatchMessage({
      type: 'questionResponse',
      questionId: 'question_123',
      selectedOptionIndexes: [1, '2', -1, 2.4, 0, 'invalid'],
      source: 'user'
    });

    expect(onQuestionResponse).toHaveBeenCalledWith('question_123', [1, 2, 0], 'user');
    expect(provider.webviewMessageHandler.handleMessage).not.toHaveBeenCalled();
  });

  it('emits deterministic dispatch-failed status when ToolManager question handling throws', async () => {
    const { dispatchMessage, provider } = createHarness({
      toolManagerHandle: () => {
        throw new Error('dispatch failed');
      }
    });

    await dispatchMessage({
      type: 'questionResponse',
      questionId: 'question_456',
      selectedOptionIndexes: [0],
      source: 'user'
    });

    expect(provider.sendMessageToWebview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'resilienceStatus',
        code: 'QUESTION_RESPONSE_DISPATCH_FAILED'
      })
    );
    expect(provider.sendMessageToWebview).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'systemMessage',
        code: 'QUESTION_RESPONSE_DISPATCH_FAILED'
      })
    );
  });
});

