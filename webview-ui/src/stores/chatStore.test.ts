import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';

let chatStore: any;

beforeAll(async () => {
  (globalThis as any).acquireVsCodeApi = () => ({
    postMessage: () => {},
    getState: () => undefined,
    setState: () => {}
  });

  const module = await import('./chatStore');
  chatStore = module.chatStore;
});

describe('chatStore hydrateMessages reconciliation', () => {
  beforeEach(() => {
    chatStore.clear();
  });

  it('preserves existing plan cards when loadMessages omits them', () => {
    chatStore.addMessage({
      id: 'plan_plan_1',
      role: 'system',
      content: 'Plan',
      timestamp: 1,
      planCard: {
        planId: 'plan_1',
        goal: 'Goal',
        status: 'awaiting_approval',
        steps: [],
        completedSteps: 0,
        totalSteps: 0,
        awaitingApproval: true,
        pendingApproval: {
          approvalRequestId: 'req_1'
        }
      }
    } as any);

    chatStore.hydrateMessages([
      {
        id: 'msg_1',
        role: 'user',
        content: 'hello',
        timestamp: 2
      } as any
    ]);

    const state = get(chatStore as any);
    expect(state.messages.some((message: any) => message.id === 'plan_plan_1')).toBe(true);
  });
});
