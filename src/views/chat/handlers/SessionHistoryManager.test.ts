import { describe, expect, it, vi } from 'vitest';
import { SessionHistoryManager } from './SessionHistoryManager';
import { SessionType } from '../../../services/HistoryManager';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: []
  }
}));

describe('SessionHistoryManager session isolation', () => {
  it('creates a fresh chat session when no active session exists instead of reviving an older one', async () => {
    const createSession = vi.fn().mockResolvedValue({ id: 'session_new' });
    const addMessage = vi.fn().mockResolvedValue(undefined);
    const sessionManager = {
      getActiveSession: vi.fn().mockResolvedValue(null),
      createSession,
      getChatProvider: vi.fn(() => ({ addMessage }))
    } as any;

    const manager = new SessionHistoryManager({} as any, sessionManager, vi.fn());
    await manager.saveMessageToHistory({
      id: 'msg_1',
      role: 'assistant',
      content: 'hello',
      timestamp: Date.now()
    } as any);

    expect(createSession).toHaveBeenCalledWith(SessionType.CHAT, expect.objectContaining({
      name: expect.stringContaining('Chat Session')
    }));
    expect(addMessage).toHaveBeenCalledWith(
      'session_new',
      expect.objectContaining({
        role: 'assistant',
        content: 'hello'
      })
    );
  });

  it('tracks activeSessionId on context when message is persisted', async () => {
    const addMessage = vi.fn().mockResolvedValue(undefined);
    const sessionManager = {
      getActiveSession: vi.fn().mockResolvedValue({ id: 'session_active' }),
      getChatProvider: vi.fn(() => ({ addMessage }))
    } as any;
    const manager = new SessionHistoryManager({} as any, sessionManager, vi.fn());
    const context: any = {
      conversationHistory: [],
      activeSessionId: null
    };

    await manager.addMessageToHistory(context, 'enhanced', 'original', []);

    expect(context.activeSessionId).toBe('session_active');
  });
});
