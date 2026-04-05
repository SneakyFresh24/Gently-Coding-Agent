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

  it('does not preserve terminal plan cards when loadMessages omits them', () => {
    chatStore.addMessage({
      id: 'plan_plan_terminal',
      role: 'system',
      content: 'Terminal Plan',
      timestamp: 1,
      planCard: {
        planId: 'plan_terminal',
        goal: 'Done',
        status: 'completed',
        steps: [],
        completedSteps: 3,
        totalSteps: 3,
        awaitingApproval: false,
        pendingApproval: null
      }
    } as any);

    chatStore.hydrateMessages([
      {
        id: 'msg_2',
        role: 'user',
        content: 'world',
        timestamp: 2
      } as any
    ]);

    const state = get(chatStore as any);
    expect(state.messages.some((message: any) => message.id === 'plan_plan_terminal')).toBe(false);
  });

  it('normalizes hydrated terminal plan cards to non-live system messages', () => {
    chatStore.hydrateMessages([
      {
        id: 'plan_plan_3',
        role: 'system',
        content: 'Plan done',
        timestamp: 3,
        planCard: {
          planId: 'plan_3',
          goal: 'Done goal',
          status: 'completed',
          steps: [],
          completedSteps: 5,
          totalSteps: 5,
          awaitingApproval: false,
          pendingApproval: null
        }
      } as any
    ]);

    const state = get(chatStore as any);
    const message = state.messages.find((entry: any) => entry.id === 'plan_plan_3');
    expect(message).toBeTruthy();
    expect(Boolean(message.planCard)).toBe(false);
    expect(message.isSystemMessage).toBe(true);
  });

  it('stays consistent across five sequential message-plan-complete cycles without sticky live plan cards', () => {
    const baseMessages: any[] = [];
    let timestamp = 10;

    for (let index = 1; index <= 5; index += 1) {
      const userMessage = {
        id: `user_${index}`,
        role: 'user',
        content: `request_${index}`,
        timestamp: timestamp++
      };
      baseMessages.push(userMessage);

      const livePlanMessage = {
        id: `plan_plan_${index}`,
        role: 'system',
        content: `Plan ${index} live`,
        timestamp: timestamp++,
        planCard: {
          planId: `plan_${index}`,
          goal: `Goal ${index}`,
          status: 'executing',
          steps: [{ id: `step_${index}`, description: `step ${index}`, status: 'in_progress' }],
          completedSteps: 0,
          totalSteps: 1,
          awaitingApproval: false,
          pendingApproval: null
        }
      };

      chatStore.hydrateMessages([...baseMessages, livePlanMessage] as any);
      let state = get(chatStore as any);
      const activeCard = state.messages.find((entry: any) => entry.id === `plan_plan_${index}`);
      expect(activeCard).toBeTruthy();
      expect(activeCard?.planCard?.status).toBe('executing');

      const completedPlanMessage = {
        ...livePlanMessage,
        content: `Plan ${index} completed`,
        planCard: {
          ...livePlanMessage.planCard,
          status: 'completed',
          steps: [{ id: `step_${index}`, description: `step ${index}`, status: 'completed' }],
          completedSteps: 1
        }
      };

      chatStore.hydrateMessages([...baseMessages, completedPlanMessage] as any);
      state = get(chatStore as any);
      const archivedEntry = state.messages.find((entry: any) => entry.id === `plan_plan_${index}`);
      expect(archivedEntry).toBeTruthy();
      expect(Boolean(archivedEntry?.planCard)).toBe(false);
      expect(archivedEntry?.isSystemMessage).toBe(true);

      chatStore.hydrateMessages([...baseMessages] as any);
      state = get(chatStore as any);
      expect(
        state.messages.some(
          (entry: any) => entry.id === `plan_plan_${index}` && Boolean(entry.planCard)
        )
      ).toBe(false);
    }

    const finalState = get(chatStore as any);
    expect(finalState.messages).toHaveLength(5);
    expect(finalState.messages.every((entry: any) => !entry.planCard)).toBe(true);
  });
});
