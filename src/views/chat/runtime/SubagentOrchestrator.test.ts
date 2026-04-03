import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatViewContext } from '../types/ChatTypes';
import { SubagentOrchestrator, SubagentResilienceSettings } from './SubagentOrchestrator';

function createContext(overrides: Partial<ChatViewContext> = {}): ChatViewContext {
  return {
    agentMode: false,
    selectedModel: 'openai/gpt-4o-mini',
    selectedMode: 'architect',
    conversationHistory: [],
    shouldStopStream: false,
    shouldAbortTools: false,
    currentFlowId: 'flow-r3-test',
    messageCheckpoints: new Map(),
    toolExecutionStartSent: new Set(),
    ...overrides
  };
}

const settings: SubagentResilienceSettings = {
  killSwitch: false,
  subagentOrchestratorV1: true,
  subagentErrorContractV1: true,
  subagentTelemetryV1: false
};

describe('SubagentOrchestrator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs deterministic architect->coder handover and emits summary status', async () => {
    const sendMessageToWebview = vi.fn();
    const performModeSwitch = vi.fn(async (_modeId: string) => undefined);
    const sendContinuationMessage = vi.fn(async () => undefined);
    const context = createContext();

    const orchestrator = new SubagentOrchestrator({
      hookManager: {
        executePreHooks: vi.fn(async (_name, params) => ({ blocked: false, modifiedParams: params })),
        executePostHooks: vi.fn(async () => ({ failures: [] })),
        executeNotification: vi.fn(async () => ({ failures: [] }))
      } as any,
      sendMessageToWebview,
      performModeSwitch: async (modeId: string) => {
        await performModeSwitch(modeId);
        context.selectedMode = modeId;
      },
      sendContinuationMessage,
      hasPersistedPlan: () => true,
      getSettings: () => settings
    });

    const consumed = await orchestrator.runArchitectToCoder(context, {
      sourceToolName: 'handover_to_coder',
      requestedMode: 'code',
      continuationPrompt: 'start implementation'
    });

    expect(consumed).toBe(true);
    expect(performModeSwitch).toHaveBeenCalledWith('code');
    expect(sendContinuationMessage).toHaveBeenCalledWith('start implementation');
    const statusCodes = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .filter((msg) => msg.type === 'subagentStatus')
      .map((msg) => msg.code);
    expect(statusCodes).toContain('SUBAGENT_MODE_SWITCHED');
    expect(statusCodes).toContain('SUBAGENT_SUMMARY_READY');
  });

  it('fails closed on prehook block and does not start worker', async () => {
    const sendMessageToWebview = vi.fn();
    const performModeSwitch = vi.fn(async (_modeId: string) => undefined);
    const sendContinuationMessage = vi.fn(async () => undefined);
    const context = createContext();

    const orchestrator = new SubagentOrchestrator({
      hookManager: {
        executePreHooks: vi.fn(async () => ({
          blocked: true,
          reason: 'blocked by policy',
          code: 'HOOK_PRE_BLOCKED',
          modifiedParams: {}
        })),
        executePostHooks: vi.fn(async () => ({ failures: [] })),
        executeNotification: vi.fn(async () => ({ failures: [] }))
      } as any,
      sendMessageToWebview,
      performModeSwitch: async (modeId: string) => {
        await performModeSwitch(modeId);
        context.selectedMode = modeId;
      },
      sendContinuationMessage,
      hasPersistedPlan: () => true,
      getSettings: () => settings
    });

    const consumed = await orchestrator.runArchitectToCoder(context, {
      sourceToolName: 'handover_to_coder',
      requestedMode: 'code'
    });

    expect(consumed).toBe(true);
    expect(performModeSwitch).not.toHaveBeenCalled();
    expect(sendContinuationMessage).not.toHaveBeenCalled();
    const terminal = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .find((msg) => msg.type === 'subagentStatus' && msg.code === 'SUBAGENT_PREHOOK_BLOCKED');
    expect(terminal).toBeTruthy();
  });

  it('keeps success path alive when posthook fails (fail-open)', async () => {
    const sendMessageToWebview = vi.fn();
    const sendContinuationMessage = vi.fn(async () => undefined);
    const context = createContext();

    const orchestrator = new SubagentOrchestrator({
      hookManager: {
        executePreHooks: vi.fn(async (_name, params) => ({ blocked: false, modifiedParams: params })),
        executePostHooks: vi.fn(async () => ({
          failures: [{ code: 'HOOK_POST_FAILED', hookName: 'audit', message: 'audit failed' }]
        })),
        executeNotification: vi.fn(async () => ({ failures: [] }))
      } as any,
      sendMessageToWebview,
      performModeSwitch: async (modeId: string) => {
        context.selectedMode = modeId;
      },
      sendContinuationMessage,
      hasPersistedPlan: () => true,
      getSettings: () => settings
    });

    const consumed = await orchestrator.runArchitectToCoder(context, {
      sourceToolName: 'handover_to_coder',
      requestedMode: 'code'
    });

    expect(consumed).toBe(true);
    expect(sendContinuationMessage).toHaveBeenCalledTimes(1);
    const postHookStatus = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .find((msg) => msg.type === 'subagentStatus' && msg.code === 'SUBAGENT_POSTHOOK_FAILED');
    expect(postHookStatus).toBeTruthy();
    const summaryStatus = sendMessageToWebview.mock.calls
      .map((call) => call[0])
      .find((msg) => msg.type === 'subagentStatus' && msg.code === 'SUBAGENT_SUMMARY_READY');
    expect(summaryStatus).toBeTruthy();
  });
});
