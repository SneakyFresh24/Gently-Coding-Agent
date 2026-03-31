import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TraditionalToolExecutor } from './ExecutionDispatchers';
import { ChatViewContext } from '../types/ChatTypes';
import { ToolCall } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn()
  }
}));

function createContext(overrides: Partial<ChatViewContext> = {}): ChatViewContext {
  return {
    agentMode: false,
    selectedModel: 'openai/gpt-4o',
    selectedMode: 'code',
    conversationHistory: [],
    shouldStopStream: false,
    messageCheckpoints: new Map(),
    toolExecutionStartSent: new Set(),
    ...overrides
  };
}

function createToolCall(id: string, name = 'write_file', args = { path: 'a.txt', content: 'x' }): ToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args)
    }
  };
}

describe('TraditionalToolExecutor loop handling', () => {
  let executeNotification: ReturnType<typeof vi.fn>;
  let executeTools: ReturnType<typeof vi.fn>;
  let executor: TraditionalToolExecutor;

  beforeEach(() => {
    executeNotification = vi.fn().mockResolvedValue(undefined);
    executeTools = vi.fn(async (calls: Array<{ id: string }>) =>
      calls.map((call) => ({ id: call.id, result: { ok: true } }))
    );

    const agentManager = {
      getToolManager: () => ({ executeTools }),
      getHookManager: () => ({ executeNotification })
    } as any;

    executor = new TraditionalToolExecutor(
      agentManager,
      vi.fn(),
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined)
    );
  });

  it('emits loop.hard_block and abort notification at hard threshold', async () => {
    const logEventSpy = vi.spyOn(LogService.prototype, 'event');
    (executor as any).askDoomLoopPermission = vi.fn().mockResolvedValue('continue');
    const context = createContext();
    const toolCalls = ['1', '2', '3', '4', '5'].map((id) => createToolCall(id));

    const results = await (executor as any).executeToolCallsParallel(toolCalls, context);

    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(executeTools.mock.calls[0][0]).toHaveLength(4);
    expect(results).toHaveLength(5);
    expect(results.filter((r: any) => !r.success)).toHaveLength(1);

    const hardNotification = executeNotification.mock.calls
      .map((call) => call[0])
      .find((payload) => payload?.action === 'abort');
    expect(hardNotification).toMatchObject({
      channel: 'loop_escalation',
      severity: 'error',
      action: 'abort',
      metadata: { toolName: 'write_file', count: 5, action: 'abort' }
    });

    expect(logEventSpy).toHaveBeenCalledWith(
      'ERROR',
      'loop.hard_block',
      expect.stringContaining('LOOP_HARD_ESCALATION'),
      expect.objectContaining({ toolName: 'write_file', count: 5, action: 'abort' })
    );
  });

  it('resets loop state on strategic mode switch and keeps state for non-strategic switch', async () => {
    const strategicContext = createContext({
      selectedMode: 'architect',
      loopDetectorState: { lastSignature: 'sig', count: 4 }
    });

    await (executor as any).handlePostToolAction(strategicContext, {
      requestedMode: 'code',
      continuationPrompt: 'next'
    });

    expect(strategicContext.loopDetectorState?.count).toBe(0);
    expect(strategicContext.loopDetectorState?.lastSignature).toBeUndefined();

    const nonStrategicContext = createContext({
      selectedMode: 'code',
      loopDetectorState: { lastSignature: 'sig', count: 4 }
    });

    await (executor as any).handlePostToolAction(nonStrategicContext, {
      requestedMode: 'review',
      continuationPrompt: 'next'
    });

    expect(nonStrategicContext.loopDetectorState?.count).toBe(4);
    expect(nonStrategicContext.loopDetectorState?.lastSignature).toBe('sig');
  });
});
