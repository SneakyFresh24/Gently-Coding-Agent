import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TraditionalToolExecutor, ToolCallDispatcher } from './ExecutionDispatchers';
import { ChatViewContext } from '../types/ChatTypes';
import { ToolCall } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback?: unknown) => fallback
    })
  },
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

function createToolCall(id: string, name = 'write_file', args: Record<string, unknown> = { path: 'a.txt', content: 'x' }): ToolCall {
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
  let performModeSwitch: ReturnType<typeof vi.fn>;
  let sendContinuationMessage: ReturnType<typeof vi.fn>;
  let sendMessageToWebview: ReturnType<typeof vi.fn>;
  let updateConversationHistory: ReturnType<typeof vi.fn>;
  let activeContext: ChatViewContext | null;
  let executor: TraditionalToolExecutor;
  let planningManager: {
    getCurrentPlan: ReturnType<typeof vi.fn>;
    prepareCodeEntry: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    executeNotification = vi.fn().mockResolvedValue(undefined);
    executeTools = vi.fn(async (calls: Array<{ id: string }>) =>
      calls.map((call) => ({ id: call.id, result: { ok: true } }))
    );
    activeContext = null;
    performModeSwitch = vi.fn(async (modeId: string) => {
      if (activeContext) {
        activeContext.selectedMode = modeId;
      }
    });
    sendContinuationMessage = vi.fn().mockResolvedValue(undefined);
    sendMessageToWebview = vi.fn();
    updateConversationHistory = vi.fn();

    planningManager = {
      getCurrentPlan: vi.fn(() => ({ id: 'plan-1', steps: [{ id: 's1' }] })),
      prepareCodeEntry: vi.fn(async () => ({
        ok: true,
        code: 'CODE_ENTRY_ALLOWED',
        reason: 'Code entry allowed for plan status "handed_over".',
        planId: 'plan-1',
        planStatus: 'handed_over',
        autoHandedOver: false
      }))
    };

    const agentManager = {
      getToolManager: () => ({ executeTools }),
      getHookManager: () => ({ executeNotification, executePreHooks: vi.fn(async (_name: string, params: any) => ({ blocked: false, modifiedParams: params })), executePostHooks: vi.fn(async () => ({ failures: [] })) }),
      getPlanningManager: () => planningManager
    } as any;

    executor = new TraditionalToolExecutor(
      agentManager,
      sendMessageToWebview,
      updateConversationHistory,
      vi.fn().mockResolvedValue(undefined),
      performModeSwitch,
      sendContinuationMessage
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

  it('forwards flow correlation metadata to ToolManager executeTools', async () => {
    const context = createContext({
      currentFlowId: 'flow-123',
      selectedMode: 'architect',
      selectedModel: 'anthropic/claude-sonnet-4'
    } as Partial<ChatViewContext>);
    activeContext = context;

    await (executor as any).executeToolCallsParallel([createToolCall('tc-1', 'read_file', { path: 'README.md' })], context);

    expect(executeTools).toHaveBeenCalledTimes(1);
    const mappedCall = executeTools.mock.calls[0][0][0];
    expect(mappedCall).toMatchObject({
      id: 'tc-1',
      name: 'read_file',
      flowId: 'flow-123',
      correlationId: 'flow-123:tc-1',
      mode: 'architect',
      model: 'anthropic/claude-sonnet-4'
    });
  });

  it('blocks post-tool mode switch when code entry gate rejects', async () => {
    const context = createContext({
      selectedMode: 'architect',
      currentFlowId: 'flow-blocked'
    });
    planningManager.prepareCodeEntry = vi.fn(async () => ({
      ok: false,
      code: 'PLAN_APPROVAL_PENDING_EXPLICIT',
      reason: 'Plan is awaiting explicit approval before code execution.',
      planId: 'plan-1',
      planStatus: 'awaiting_approval'
    }));

    await (executor as any).handlePostToolAction(context, {
      requestedMode: 'code',
      continuationPrompt: 'next'
    });

    expect(performModeSwitch).not.toHaveBeenCalled();
    const statuses = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.type === 'resilienceStatus');
    expect(statuses.some((msg) => msg.code === 'CODE_ENTRY_BLOCKED')).toBe(true);
  });

  it('routes handover_to_coder through subagent orchestrator and emits subagentStatus', async () => {
    executeTools.mockResolvedValueOnce([
      {
        id: 'handover-1',
        result: {
          success: true,
          requestedMode: 'code',
          shouldAutoContinue: true,
          continuationPrompt: 'Implement step 1 now.'
        }
      }
    ]);

    const context = createContext({
      selectedMode: 'architect',
      selectedModel: 'openai/gpt-4o',
      currentFlowId: 'flow-handover-1'
    } as Partial<ChatViewContext>);
    activeContext = context;

    await executor.execute([createToolCall('handover-1', 'handover_to_coder', { message: 'handover' })], 'msg-1', context);

    expect(performModeSwitch).toHaveBeenCalledWith('code');
    expect(sendContinuationMessage).toHaveBeenCalledWith('Implement step 1 now.');
    const statusCodes = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg.type === 'subagentStatus')
      .map((msg) => msg.code);
    expect(statusCodes).toContain('SUBAGENT_START');
    expect(statusCodes).toContain('SUBAGENT_MODE_SWITCHED');
    expect(statusCodes).toContain('SUBAGENT_SUMMARY_READY');
  });

  it('skips post-tool continuation when stop was requested', async () => {
    const context = createContext({
      shouldStopStream: true,
      shouldAbortTools: true,
      selectedMode: 'code'
    });
    activeContext = context;

    await (executor as any).handlePostToolAction(context, {
      requestedMode: 'code',
      continuationPrompt: 'continue now'
    });

    expect(sendContinuationMessage).not.toHaveBeenCalled();
  });

  it('normalizes create_plan pseudo-success without steps into strict failure contract', async () => {
    executeTools.mockResolvedValueOnce([
      {
        id: 'create-plan-1',
        result: {
          success: true,
          plan: { id: 'plan_x', steps: [] }
        }
      }
    ]);

    const context = createContext({
      selectedMode: 'architect',
      currentFlowId: 'flow-create-plan-guard'
    });
    activeContext = context;

    await executor.execute([createToolCall('create-plan-1', 'create_plan', { goal: 'x', steps: [{ description: 'a', tool: 'read_file', parameters: {} }] })], 'msg-guard', context);

    const toolHistoryMessages = updateConversationHistory.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.role === 'tool');
    expect(toolHistoryMessages.length).toBeGreaterThan(0);
    const parsed = JSON.parse(String(toolHistoryMessages[0].content));
    expect(parsed.success).toBe(false);
    expect(parsed.code).toBe('CREATE_PLAN_RENDER_GUARD_TRIGGERED');
  });
});

describe('ToolCallDispatcher mode desync + validation guard', () => {
  function createDispatcher(sendMessageToWebview: ReturnType<typeof vi.fn>, getActiveModeId?: () => string | null) {
    const toolCallManager = {
      processToolCalls: vi.fn()
    } as any;
    const followUp = {
      sendFollowUpMessage: vi.fn().mockResolvedValue(undefined)
    } as any;
    const agentManager = {
      getToolManager: () => ({ executeTools: vi.fn().mockResolvedValue([]) }),
      getHookManager: () => ({ executeNotification: vi.fn().mockResolvedValue(undefined), executePreHooks: vi.fn(async (_name: string, params: any) => ({ blocked: false, modifiedParams: params })), executePostHooks: vi.fn(async () => ({ failures: [] })) }),
      getPlanningManager: () => ({
        getCurrentPlan: () => ({ id: 'plan-1', steps: [{ id: 's1' }] }),
        prepareCodeEntry: vi.fn(async () => ({
          ok: true,
          code: 'CODE_ENTRY_ALLOWED',
          reason: 'Code entry allowed for plan status "handed_over".',
          planId: 'plan-1',
          planStatus: 'handed_over',
          autoHandedOver: false
        }))
      })
    } as any;

    const dispatcher = new ToolCallDispatcher(
      toolCallManager,
      followUp,
      sendMessageToWebview,
      agentManager,
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
      getActiveModeId
    );

    return { dispatcher, toolCallManager, followUp };
  }

  it('self-heals mode desync and emits structured mode-block status', async () => {
    const sendMessageToWebview = vi.fn();
    const { dispatcher, toolCallManager } = createDispatcher(sendMessageToWebview, () => 'architect');
    const context = createContext({
      selectedMode: 'code',
      currentFlowId: 'flow-mode-1'
    });
    const toolCalls = [createToolCall('call-1', 'create_plan', { goal: 'x', steps: [{ title: 's1' }] })];

    toolCallManager.processToolCalls.mockImplementation(async (_calls: any, ctx: any) => {
      expect(ctx.selectedMode).toBe('architect');
      return {
        valid: false,
        errors: ['MODE_TOOL_BLOCKED: ACT_STRICT forbids planning tool "create_plan".'],
        warnings: [],
        toolCallGroups: []
      };
    });

    const outcome = await dispatcher.handleToolCalls(toolCalls, 'msg-1', context);

    expect(context.selectedMode).toBe('architect');
    expect(outcome).toMatchObject({
      ok: false,
      terminalCode: 'MODE_TOOL_BLOCKED'
    });
    const statuses = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg?.type === 'resilienceStatus');

    expect(statuses.some((msg) => msg.code === 'MODE_STATE_DESYNC_DETECTED')).toBe(true);
    expect(statuses.some((msg) => msg.code === 'MODE_TOOL_BLOCKED' && msg.action === 'switch_to_plan')).toBe(true);
    expect(sendMessageToWebview).toHaveBeenCalledWith(expect.objectContaining({ type: 'processingEnd' }));
    expect(sendMessageToWebview).toHaveBeenCalledWith(expect.objectContaining({ type: 'generatingEnd' }));
  });
});
