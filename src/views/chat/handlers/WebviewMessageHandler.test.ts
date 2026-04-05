import { describe, expect, it, vi } from 'vitest';
import { WebviewMessageHandler } from './WebviewMessageHandler';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      update: vi.fn()
    }),
    workspaceFolders: []
  },
  commands: {
    executeCommand: vi.fn()
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      dispose: vi.fn()
    })
  }
}));

function createHandler(overrides?: {
  planningManager?: any;
  sendMessage?: (message: any) => void;
  activeSession?: any;
  sessionById?: any;
}) {
  const planningManager = overrides?.planningManager || {
    getCurrentPlan: vi.fn().mockReturnValue(undefined),
    resolvePlanApproval: vi.fn(),
    getPlan: vi.fn().mockReturnValue(undefined)
  };
  const sendMessage = overrides?.sendMessage || vi.fn();
  const agentManager = {
    getPlanningManager: vi.fn().mockReturnValue(planningManager),
    getServiceProvider: vi.fn().mockReturnValue({ getService: vi.fn() }),
    getContextManager: vi.fn().mockReturnValue({ hydrateContext: vi.fn() }),
    getCheckpointManager: vi.fn().mockReturnValue({ getCheckpointsForMessage: vi.fn(), getDiffSet: vi.fn() })
  };

  const activeSession = overrides?.activeSession ?? null;
  const sessionById = overrides?.sessionById ?? null;
  const handler = new WebviewMessageHandler(
    {
      sendMessage: vi.fn(),
      clearHistory: vi.fn(),
      stopMessage: vi.fn(),
      getSessionManager: vi.fn(() => ({
        getActiveSession: vi.fn().mockResolvedValue(activeSession)
      }))
    } as any,
    {
      handleGetSessions: vi.fn(),
      handleNewSession: vi.fn(),
      handleSwitchSession: vi.fn(),
      handleSessionAction: vi.fn(),
      handleSearchSessions: vi.fn(),
      refreshSessions: vi.fn(),
      updateSessionWithPlan: vi.fn(),
      updateSessionMetadata: vi.fn(),
      getSessionById: vi.fn().mockResolvedValue(sessionById)
    } as any,
    { handleOpenFilePicker: vi.fn(), handleTogglePinFile: vi.fn(), handleOpenFile: vi.fn(), handleSearchFiles: vi.fn(), handleRequestFilePreview: vi.fn() } as any,
    { agentManager } as any,
    { setKey: vi.fn(), deleteKey: vi.fn(), hasKey: vi.fn() } as any,
    { listModels: vi.fn() } as any,
    sendMessage as any
  );

  return { handler, planningManager, sendMessage };
}

describe('WebviewMessageHandler plan approval intent', () => {
  it('detects German approval text with "genehmige"', () => {
    const { handler } = createHandler();
    const intent = (handler as any).detectPlanApprovalIntent('Ich genehmige den Plan.');
    expect(intent).toEqual({
      decision: 'approved',
      reason: 'approved_via_chat_text'
    });
  });

  it('routes chat-text approvals through resolver with approvalRequestId', async () => {
    const resolvePlanApproval = vi.fn().mockResolvedValue({ resolution: 'applied', reasonCode: 'approved' });
    const currentPlan = {
      id: 'plan_1',
      status: 'awaiting_approval',
      pendingApproval: { approvalRequestId: 'req_1' }
    };
    const { handler, planningManager } = createHandler({
      planningManager: {
        getCurrentPlan: vi.fn().mockReturnValue(currentPlan),
        resolvePlanApproval
      }
    });
    planningManager.getCurrentPlan = vi.fn().mockReturnValue(currentPlan);

    const resolved = await (handler as any).tryResolvePlanApprovalFromChatText('Plan ist genehmigt');
    expect(resolved).toBe(true);
    expect(resolvePlanApproval).toHaveBeenCalledWith(
      'plan_1',
      'approved',
      'approved_via_chat_text',
      'user',
      { approvalRequestId: 'req_1' }
    );
  });

  it('routes planApprovalResponse through resolver with approvalRequestId', async () => {
    const resolvePlanApproval = vi.fn().mockResolvedValue({ resolution: 'applied', reasonCode: 'approved' });
    const getPlan = vi.fn().mockReturnValue({ id: 'plan_1', status: 'approved', steps: [] });
    const sendMessage = vi.fn();
    const { handler } = createHandler({
      planningManager: {
        getCurrentPlan: vi.fn().mockReturnValue(undefined),
        resolvePlanApproval,
        getPlan
      },
      sendMessage
    });

    await handler.handleMessage(
      {
        type: 'planApprovalResponse',
        planId: 'plan_1',
        approvalRequestId: 'req_1',
        approved: true,
        source: 'user'
      } as any,
      { webview: { postMessage: vi.fn() } } as any
    );

    expect(resolvePlanApproval).toHaveBeenCalledWith(
      'plan_1',
      'approved',
      undefined,
      'user',
      { approvalRequestId: 'req_1' }
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planCardUpdated'
      })
    );
  });

  it('emits warning system message when planApprovalResponse is stale or mismatched', async () => {
    const resolvePlanApproval = vi.fn().mockResolvedValue({
      resolution: 'mismatch',
      reasonCode: 'approval_request_id_mismatch'
    });
    const sendMessage = vi.fn();
    const { handler } = createHandler({
      planningManager: {
        getCurrentPlan: vi.fn().mockReturnValue(undefined),
        resolvePlanApproval,
        getPlan: vi.fn().mockReturnValue({ id: 'plan_1', status: 'awaiting_approval', steps: [] })
      },
      sendMessage
    });

    await handler.handleMessage(
      {
        type: 'planApprovalResponse',
        planId: 'plan_1',
        approvalRequestId: 'wrong_req',
        approved: true,
        source: 'user'
      } as any,
      { webview: { postMessage: vi.fn() } } as any
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'systemMessage',
        code: 'PLAN_APPROVAL_MISMATCH'
      })
    );
  });

  it('returns currentPlanResponse scoped to the requested session', async () => {
    const sendMessage = vi.fn();
    const { handler, planningManager } = createHandler({
      planningManager: {
        getCurrentPlan: vi.fn().mockReturnValue({ id: 'plan_other' }),
        getPlan: vi.fn((id: string) => (id === 'plan_scoped' ? { id: 'plan_scoped', status: 'executing' } : null))
      },
      sendMessage,
      sessionById: {
        id: 'session_2',
        metadata: {
          tasks: {
            currentPlanId: 'plan_scoped'
          }
        }
      }
    });

    await handler.handleMessage(
      { type: 'requestCurrentPlan', sessionId: 'session_2' } as any,
      { webview: { postMessage: vi.fn() } } as any
    );

    expect(planningManager.getPlan).toHaveBeenCalledWith('plan_scoped');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'currentPlanResponse',
        sessionId: 'session_2',
        plan: expect.objectContaining({ id: 'plan_scoped' })
      })
    );
  });
});
