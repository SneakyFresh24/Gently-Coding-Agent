import { describe, expect, it, vi } from 'vitest';
import { SessionHandler } from './SessionHandler';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    getConfiguration: () => ({ get: vi.fn(), update: vi.fn() })
  },
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn().mockReturnValue({
      appendLine: vi.fn(),
      dispose: vi.fn()
    })
  },
  Uri: {
    file: vi.fn((path: string) => ({ fsPath: path }))
  }
}));

describe('SessionHandler restore task normalization', () => {
  it('normalizes tasks payload and preserves pendingPlanApproval', () => {
    const handler = new SessionHandler(
      {} as any,
      vi.fn()
    );

    const normalized = (handler as any).normalizeRestoreTasksPayload({
      currentPlanId: 'plan_1',
      plans: [{ id: 'plan_1', status: 'awaiting_approval' }],
      pendingPlanApproval: { approvalRequestId: 'req_1', expiresAt: 123 }
    });

    expect(normalized.currentPlanId).toBe('plan_1');
    expect(normalized.currentPlan?.id).toBe('plan_1');
    expect(normalized.pendingPlanApproval).toEqual(
      expect.objectContaining({
        approvalRequestId: 'req_1'
      })
    );
  });

  it('falls back to plan.pendingApproval when top-level pendingPlanApproval is absent', () => {
    const handler = new SessionHandler(
      {} as any,
      vi.fn()
    );

    const normalized = (handler as any).normalizeRestoreTasksPayload({
      currentPlan: {
        id: 'plan_2',
        status: 'awaiting_approval',
        pendingApproval: { approvalRequestId: 'req_2', expiresAt: 456 }
      },
      plans: []
    });

    expect(normalized.currentPlanId).toBe('plan_2');
    expect(normalized.pendingPlanApproval).toEqual(
      expect.objectContaining({
        approvalRequestId: 'req_2'
      })
    );
  });

  it('updateSessionWithPlan persists tasks.currentPlanId while preserving existing task metadata', async () => {
    const updateSession = vi.fn().mockResolvedValue(undefined);
    const getActiveSession = vi.fn().mockResolvedValue({
      id: 'session_1',
      metadata: {
        tasks: {
          plans: [{ id: 'plan_old' }],
          currentPlanId: 'plan_old',
          pendingPlanApproval: { approvalRequestId: 'req_old' }
        }
      }
    });

    const handler = new SessionHandler(
      {
        getActiveSession,
        updateSession
      } as any,
      vi.fn()
    );

    await handler.updateSessionWithPlan('plan_new');

    expect(updateSession).toHaveBeenCalledWith(
      'session_1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          activePlanId: 'plan_new',
          tasks: expect.objectContaining({
            currentPlanId: 'plan_new',
            plans: expect.any(Array)
          })
        })
      })
    );
  });

  it('invokes onSessionActivated callback when creating a new session', async () => {
    const onSessionActivated = vi.fn().mockResolvedValue(undefined);
    const createdSession = {
      id: 'session_new',
      metadata: { model: 'openai/gpt-4o-mini' }
    };
    const sessionManager = {
      createSession: vi.fn().mockResolvedValue(createdSession),
      setActiveSession: vi.fn().mockResolvedValue(undefined),
      getSessionsByType: vi.fn().mockResolvedValue([createdSession]),
      getActiveSession: vi.fn().mockResolvedValue(createdSession),
      refreshSessions: vi.fn().mockResolvedValue(undefined)
    };

    const handler = new SessionHandler(
      sessionManager as any,
      vi.fn(),
      vi.fn().mockResolvedValue(undefined),
      undefined,
      undefined,
      onSessionActivated
    );

    await handler.handleNewSession();

    expect(onSessionActivated).toHaveBeenCalledWith(expect.objectContaining({ id: 'session_new' }));
  });
});
