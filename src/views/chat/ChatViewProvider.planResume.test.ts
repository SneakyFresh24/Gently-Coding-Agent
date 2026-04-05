import { describe, expect, it, vi } from 'vitest';
import { ChatViewProvider } from './ChatViewProvider';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn()
    }))
  }
}));

function createProviderHarness(options?: { busy?: boolean; prepareOk?: boolean; prepareThrows?: boolean; sendMessageReject?: boolean }) {
  let activeMode = 'architect';
  const postMessage = vi.fn();
  const captureOutboundMessage = vi.fn();
  const setSelectedMode = vi.fn(async (modeId: string) => {
    activeMode = modeId;
  });
  const sendMessage = vi.fn(async () => undefined);
  const prepareCodeEntry = vi.fn(async () => {
    if (options?.prepareThrows) {
      throw new Error('prepare failed');
    }
    if (options?.prepareOk === false) {
      return {
        ok: false,
        code: 'PLAN_APPROVAL_PENDING_EXPLICIT',
        reason: 'Plan is awaiting explicit approval before code execution.'
      };
    }
    return {
      ok: true,
      code: 'CODE_ENTRY_ALLOWED',
      reason: 'Code entry allowed.'
    };
  });
  if (options?.sendMessageReject) {
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
  }
  const beginExecution = vi.fn(async () => undefined);

  const provider = Object.create(ChatViewProvider.prototype) as any;
  provider.isDisposed = false;
  provider.processingActive = Boolean(options?.busy);
  provider.generatingActive = false;
  provider.planResumeQueue = [];
  provider.processedPlanResumeKeys = new Set<string>();
  provider.activePlanResumeRunsByFlow = new Map<string, any>();
  provider.isDrainingPlanResumeQueue = false;
  provider.planResumeRetryDelayMs = 1;
  provider.planResumeMaxAttempts = 3;
  provider.lastExecutionState = 'idle';
  provider.pendingMessages = [];
  provider._view = { webview: { postMessage } };
  provider.diagnosticService = { captureOutboundMessage };
  provider.modeService = {
    getCurrentMode: vi.fn(() => ({ id: activeMode }))
  };
  provider.setSelectedMode = setSelectedMode;
  provider.messageHandler = {
    getContext: vi.fn(() => ({
      selectedMode: activeMode,
      selectedModel: 'openai/gpt-4o-mini',
      currentFlowId: 'flow-test',
      isToolExecutionActive: false
    })),
    sendMessage
  };
  provider.agentManager = {
    getPlanningManager: vi.fn(() => ({
      prepareCodeEntry,
      beginExecution
    }))
  };

  return {
    provider,
    postMessage,
    setSelectedMode,
    sendMessage,
    prepareCodeEntry,
    beginExecution
  };
}

describe('ChatViewProvider plan approval auto-resume queue', () => {
  it('auto-resumes approved plans exactly once for the same approval request', async () => {
    const { provider, setSelectedMode, sendMessage, beginExecution } = createProviderHarness({ prepareOk: true });

    (provider as any).sendMessageToWebview({
      type: 'planApprovalResolved',
      planId: 'plan_1',
      approvalRequestId: 'req_1',
      status: 'approved',
      resolution: 'applied'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    (provider as any).sendMessageToWebview({
      type: 'planApprovalResolved',
      planId: 'plan_1',
      approvalRequestId: 'req_1',
      status: 'approved',
      resolution: 'applied'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setSelectedMode).toHaveBeenCalledTimes(1);
    expect(setSelectedMode).toHaveBeenCalledWith('code');
    expect(beginExecution).toHaveBeenCalledTimes(1);
    expect(beginExecution).toHaveBeenCalledWith('plan_1');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Implement the approved plan step by step.'),
      true,
      undefined,
      0,
      'resume'
    );
  });

  it('queues resume while busy and drains on processingEnd', async () => {
    const { provider, sendMessage } = createProviderHarness({ busy: true, prepareOk: true });

    (provider as any).sendMessageToWebview({
      type: 'planApprovalResolved',
      planId: 'plan_2',
      approvalRequestId: 'req_busy',
      status: 'approved',
      resolution: 'applied'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).not.toHaveBeenCalled();

    (provider as any).sendMessageToWebview({ type: 'processingEnd' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Implement the approved plan step by step.'),
      true,
      undefined,
      0,
      'resume'
    );
  });

  it('clears pending resume intents when stopAcknowledged is emitted', async () => {
    const { provider, postMessage } = createProviderHarness({ busy: false, prepareOk: true });
    provider.planResumeQueue.push({
      key: 'plan_3:req_3',
      planId: 'plan_3',
      approvalRequestId: 'req_3',
      enqueuedAt: Date.now(),
      attempts: 0,
      nextRetryAt: Date.now()
    });

    (provider as any).sendMessageToWebview({
      type: 'stopAcknowledged',
      flowId: 'flow-stop',
      reasonCode: 'REQUEST_STOPPED',
      timestamp: Date.now()
    });

    expect(provider.planResumeQueue).toHaveLength(0);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'executionStateUpdate',
        state: 'stopped'
      })
    );
  });

  it('re-queues plan resume on rate-limit-like runtime failure', async () => {
    const { provider, sendMessage } = createProviderHarness({ busy: false, prepareOk: true });

    (provider as any).sendMessageToWebview({
      type: 'planApprovalResolved',
      planId: 'plan_retry',
      approvalRequestId: 'req_retry',
      status: 'approved',
      resolution: 'applied'
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const activeFlowId = Array.from((provider as any).activePlanResumeRunsByFlow.keys())[0];
    expect(activeFlowId).toBeTruthy();

    (provider as any).sendMessageToWebview({
      type: 'queryRuntimeEvent',
      event: {
        type: 'result_error',
        flowId: activeFlowId,
        result: {
          code: 'UNEXPECTED_FAILURE',
          message: 'Provider is currently rate-limited. Please wait and retry.'
        }
      }
    });

    expect((provider as any).planResumeQueue.length).toBe(1);
    expect((provider as any).planResumeQueue[0].planId).toBe('plan_retry');
  });

  it('marks resume as failed after max runtime retries', async () => {
    const { provider, postMessage } = createProviderHarness({ busy: false, prepareOk: true });
    (provider as any).activePlanResumeRunsByFlow.set('flow_retry_exhausted', {
      key: 'plan_retry_exhausted:req_1',
      planId: 'plan_retry_exhausted',
      approvalRequestId: 'req_1',
      attempts: 3,
      startedAt: Date.now()
    });

    (provider as any).sendMessageToWebview({
      type: 'queryRuntimeEvent',
      event: {
        type: 'result_error',
        flowId: 'flow_retry_exhausted',
        result: {
          code: 'RATE_LIMIT_RETRY_EXHAUSTED',
          message: 'Provider is currently rate-limited.'
        }
      }
    });

    expect((provider as any).processedPlanResumeKeys.has('plan_retry_exhausted:req_1')).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'executionStateUpdate',
        state: 'failed',
        reasonCode: 'PLAN_RESUME_RETRY_EXHAUSTED'
      })
    );
  });

  it('schedules retry when resume start throws', async () => {
    const { provider } = createProviderHarness({ busy: false, prepareThrows: true });
    (provider as any).enqueuePlanResumeIntent('plan_throw', 'req_throw');

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((provider as any).planResumeQueue.length).toBe(1);
    expect((provider as any).planResumeQueue[0].attempts).toBe(1);
    expect((provider as any).planResumeQueue[0].lastError).toContain('prepare failed');
  });
});
