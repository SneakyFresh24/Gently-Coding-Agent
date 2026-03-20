import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryManager, SessionType } from './HistoryManager';

const { mockVscode } = vi.hoisted(() => ({
  mockVscode: {
    workspace: {
      workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    },
  },
}));

vi.mock('vscode', () => mockVscode);

describe('HistoryManager', () => {
  let tmpRoot: string;
  let context: any;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gently-history-'));
    context = {
      globalStorageUri: {
        fsPath: path.join(tmpRoot, 'global-storage'),
      },
    };
    mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: path.join(tmpRoot, 'workspace') } }];
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('creates, updates, reads and deletes sessions with updatedAt semantics', async () => {
    const manager = new HistoryManager(context);
    const created = await manager.createSession(SessionType.CHAT, {
      name: 'Session A',
      model: 'deepseek/deepseek-chat',
    });

    expect(created.updatedAt).toBeGreaterThanOrEqual(created.createdAt);

    const beforeUpdate = created.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    await manager.updateSession(created.id, { name: 'Session A Updated' });
    const updated = await manager.getSession(created.id);
    expect(updated?.name).toBe('Session A Updated');
    expect((updated?.updatedAt || 0) > beforeUpdate).toBe(true);

    await manager.deleteSession(created.id);
    const deleted = await manager.getSession(created.id);
    expect(deleted).toBeNull();
  });

  it('stores active sessions per type', async () => {
    const manager = new HistoryManager(context);
    const chat = await manager.createSession(SessionType.CHAT, { name: 'Chat Session' });
    const plan = await manager.createSession(SessionType.PLAN, { name: 'Plan Session' });

    await manager.setActiveSession(SessionType.CHAT, chat.id);
    await manager.setActiveSession(SessionType.PLAN, plan.id);

    const activeChat = await manager.getActiveSession(SessionType.CHAT);
    const activePlan = await manager.getActiveSession(SessionType.PLAN);
    expect(activeChat?.id).toBe(chat.id);
    expect(activePlan?.id).toBe(plan.id);
  });

  it('uses globalStorageUri/sessions when no workspace is open', async () => {
    mockVscode.workspace.workspaceFolders = [];
    const manager = new HistoryManager(context);
    const created = await manager.createSession(SessionType.CHAT, { name: 'Fallback Session' });

    const expectedPath = path.join(context.globalStorageUri.fsPath, 'sessions', `${created.id}.json`);
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('normalizes partially invalid session files', async () => {
    const sessionsDir = path.join(tmpRoot, 'workspace', '.gently', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionsDir, 'legacy.json'),
      JSON.stringify({
        id: 'legacy',
        name: 'Legacy Session',
        type: 'chat',
        createdAt: 1700000000000,
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(sessionsDir, 'broken.json'), '{ this is invalid json', 'utf8');

    const manager = new HistoryManager(context);
    const sessions = await manager.getSessionsByType(SessionType.CHAT);
    const legacy = sessions.find((s) => s.id === 'legacy');

    expect(legacy).toBeTruthy();
    expect(legacy?.updatedAt).toBe(1700000000000);
    expect(legacy?.messages).toEqual([]);
    expect(legacy?.metadata?.model).toBe('unknown');
  });
});
