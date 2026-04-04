import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ToolManager } from '../ToolManager';

const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (key in configValues ? configValues[key] : fallback)
    })
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {}
    })
  }
}));

function createToolManager() {
  const askQuestionExecute = vi.fn().mockResolvedValue({ success: true, answer: ['legacy'] });
  const toolRegistry = {
    get: vi.fn().mockImplementation((toolName: string) => {
      if (toolName === 'ask_question') {
        return { execute: askQuestionExecute };
      }
      return { execute: vi.fn().mockResolvedValue({ ok: true }) };
    })
  } as any;

  const hookManager = {
    executePreHooks: vi.fn().mockImplementation(async (_toolName: string, params: any) => ({
      blocked: false,
      modifiedParams: params
    })),
    executePostHooks: vi.fn().mockResolvedValue({ failures: [] }),
    executeNotification: vi.fn().mockResolvedValue({ failures: [] })
  } as any;

  const circuitBreakers = {
    canExecute: vi.fn().mockReturnValue({
      key: 'tool.execute',
      decision: { allowed: true, state: 'closed' },
      transition: undefined
    }),
    recordSuccess: vi.fn().mockReturnValue({
      key: 'tool.execute',
      transition: undefined
    }),
    recordFailure: vi.fn().mockReturnValue({
      key: 'tool.execute',
      transition: undefined
    })
  } as any;

  const manager = new ToolManager(
    toolRegistry,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { shouldAutoApprove: vi.fn().mockResolvedValue(true) } as any,
    hookManager,
    circuitBreakers
  );

  const events: any[] = [];
  manager.setEventCallback((event: any) => {
    events.push(event);
  });

  return { manager, events, askQuestionExecute };
}

function getQuestionRequest(events: any[]) {
  return events.find((event) => event.type === 'questionRequest');
}

describe('ToolManager ask_question webview orchestration', () => {
  beforeEach(() => {
    for (const key of Object.keys(configValues)) {
      delete configValues[key];
    }
    configValues['resilience.toolOrchestratorV2'] = true;
    configValues['resilience.hookContractV2'] = true;
    configValues['resilience.toolTelemetryV2'] = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps single-select user response to ask_question result shape', async () => {
    const { manager, events, askQuestionExecute } = createToolManager();
    const pending = manager.executeTool(
      'ask_question',
      {
        question: 'Choose mode',
        options: [
          { label: 'Stay architect' },
          { label: 'Switch to code', mode: 'code' }
        ]
      },
      { flowId: 'flow-q-1', toolCallId: 'tc-q-1' }
    );

    await vi.waitFor(() => {
      expect(getQuestionRequest(events)).toBeTruthy();
    });
    const request = getQuestionRequest(events);
    manager.handleQuestionResponse(request.questionId, [1], 'user');

    const result = await pending;
    expect(result).toMatchObject({
      success: true,
      answer: ['Switch to code'],
      requestedMode: 'code'
    });
    expect(askQuestionExecute).not.toHaveBeenCalled();
    const resolved = events.find((event) => event.type === 'questionResolved');
    expect(resolved?.source).toBe('user');
  });

  it('supports multiple selection with deterministic option ordering', async () => {
    const { manager, events } = createToolManager();
    const pending = manager.executeTool(
      'ask_question',
      {
        question: 'Select outputs',
        multiple: true,
        options: [
          { label: 'Tests only' },
          { label: 'Docs only' },
          { label: 'Both and switch', mode: 'code' }
        ]
      },
      { flowId: 'flow-q-2', toolCallId: 'tc-q-2' }
    );

    await vi.waitFor(() => {
      expect(getQuestionRequest(events)).toBeTruthy();
    });
    const request = getQuestionRequest(events);
    manager.handleQuestionResponse(request.questionId, [2, 0, 2], 'user');

    const result = await pending;
    expect(result.answer).toEqual(['Tests only', 'Both and switch']);
    expect(result.requestedMode).toBe('code');
  });

  it('auto-selects first option on timeout', async () => {
    vi.useFakeTimers();
    const { manager, events } = createToolManager();
    const pending = manager.executeTool(
      'ask_question',
      {
        question: 'Pick one',
        options: [
          { label: 'Default option', mode: 'architect' },
          { label: 'Alternative' }
        ]
      },
      { flowId: 'flow-q-3', toolCallId: 'tc-q-3' }
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await pending;
    expect(result.answer).toEqual(['Default option']);
    expect(result.requestedMode).toBe('architect');
    const resolved = events.find((event) => event.type === 'questionResolved');
    expect(resolved?.source).toBe('timeout_default');
  });

  it('stops pending question run on abort and ignores late responses', async () => {
    const { manager, events } = createToolManager();
    const pending = manager.executeTool(
      'ask_question',
      {
        question: 'Do we continue?',
        options: [
          { label: 'Yes' },
          { label: 'No' }
        ]
      },
      { flowId: 'flow-q-4', toolCallId: 'tc-q-4' }
    );

    await vi.waitFor(() => {
      expect(getQuestionRequest(events)).toBeTruthy();
    });
    const request = getQuestionRequest(events);

    manager.abortAllExecutions();
    await expect(pending).rejects.toThrow('Question stopped by user.');

    manager.handleQuestionResponse(request.questionId, [1], 'user');
    const resolvedEvents = events.filter((event) => event.type === 'questionResolved');
    expect(resolvedEvents).toHaveLength(1);
    expect(resolvedEvents[0].source).toBe('stopped');
  });

});
