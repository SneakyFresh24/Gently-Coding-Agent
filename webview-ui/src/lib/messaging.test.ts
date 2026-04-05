import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type MessageListener = (event: { data: any }) => void;

const listeners = new Map<string, Set<MessageListener>>();
const postMessageSpy = vi.fn();

let initMessaging: ((handlers: Record<string, any>) => void) | undefined;
let destroyMessaging: (() => void) | undefined;
let sendMessageToExtension: ((type: string, payload?: Record<string, any>) => boolean) | undefined;

function dispatchMessage(data: any): void {
  const messageListeners = listeners.get('message');
  if (!messageListeners) return;
  for (const listener of messageListeners) {
    listener({ data });
  }
}

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({
    postMessage: postMessageSpy,
    getState: () => undefined,
    setState: () => {}
  });

  (globalThis as any).window = {
    addEventListener: (type: string, listener: MessageListener) => {
      const bucket = listeners.get(type) || new Set<MessageListener>();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type: string, listener: MessageListener) => {
      const bucket = listeners.get(type);
      if (!bucket) return;
      bucket.delete(listener);
    }
  };

  const module = await import('./messaging');
  initMessaging = module.init;
  destroyMessaging = module.destroy;
  sendMessageToExtension = module.send;
});

beforeEach(() => {
  postMessageSpy.mockReset();
  destroyMessaging?.();
  listeners.clear();
});

describe('messaging plan/handover contract mapping', () => {
  it('routes canonical planning events to handlers without using onUnhandled', () => {
    const onPlanApprovalRequested = vi.fn();
    const onPlanApprovalResolved = vi.fn();
    const onPlanStatusUpdate = vi.fn();
    const onHandoverProgress = vi.fn();
    const onRestoreSessionState = vi.fn();
    const onCurrentPlanResponse = vi.fn();
    const onUnhandled = vi.fn();

    initMessaging?.({
      onPlanApprovalRequested,
      onPlanApprovalResolved,
      onPlanStatusUpdate,
      onHandoverProgress,
      onRestoreSessionState,
      onCurrentPlanResponse,
      onUnhandled
    });

    dispatchMessage({ type: 'planApprovalRequested', planId: 'plan_1' });
    dispatchMessage({ type: 'planApprovalResolved', planId: 'plan_1', status: 'approved' });
    dispatchMessage({ type: 'planStatusUpdate', planId: 'plan_1', status: 'approved' });
    dispatchMessage({ type: 'handoverProgress', status: 'started' });
    dispatchMessage({ type: 'restoreSessionState', tasks: { currentPlanId: 'plan_1' } });
    dispatchMessage({ type: 'currentPlanResponse', plan: { id: 'plan_1' } });

    expect(onPlanApprovalRequested).toHaveBeenCalledTimes(1);
    expect(onPlanApprovalResolved).toHaveBeenCalledTimes(1);
    expect(onPlanStatusUpdate).toHaveBeenCalledTimes(1);
    expect(onHandoverProgress).toHaveBeenCalledTimes(1);
    expect(onRestoreSessionState).toHaveBeenCalledTimes(1);
    expect(onCurrentPlanResponse).toHaveBeenCalledTimes(1);
    expect(onUnhandled).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('routes unknown message types to onUnhandled fallback', () => {
    const onUnhandled = vi.fn();
    initMessaging?.({ onUnhandled });

    dispatchMessage({ type: 'totallyUnknownMessage', payload: 1 });

    expect(onUnhandled).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'totallyUnknownMessage' })
    );
  });

  it('does not route known message types to onUnhandled when no specific handler is registered', () => {
    const onUnhandled = vi.fn();
    initMessaging?.({ onUnhandled });

    dispatchMessage({ type: 'planStepCompleted', planId: 'plan_1', stepId: 'step_1' });

    expect(onUnhandled).not.toHaveBeenCalled();
  });

  it('returns false when postMessage throws during send', () => {
    postMessageSpy.mockImplementation(() => {
      throw new Error('DataCloneError');
    });

    const ok = sendMessageToExtension?.('questionResponse', {
      questionId: 'q_1',
      selectedOptionIndexes: [0],
      source: 'user'
    });

    expect(ok).toBe(false);
  });
});
