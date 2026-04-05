import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalManager, AutoApproveManager } from './ApprovalManager';

const { mockVscode } = vi.hoisted(() => ({
  mockVscode: {
    workspace: {
      workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    },
  },
}));

vi.mock('vscode', () => mockVscode);

describe('AutoApproveManager', () => {
  const globalStore = new Map<string, any>();
  const context = {
    globalState: {
      get: vi.fn((key: string) => globalStore.get(key)),
      update: vi.fn((key: string, value: any) => {
        globalStore.set(key, value);
        return Promise.resolve();
      }),
    },
  } as any;

  beforeEach(() => {
    globalStore.clear();
    context.globalState.get.mockClear();
    context.globalState.update.mockClear();
    mockVscode.workspace.workspaceFolders = [{ uri: { fsPath: 'C:\\repo' } }];
  });

  it('uses default migration values when yoloMode is missing in stored settings', () => {
    globalStore.set('gently.autoApproveSettings', {
      version: 7,
      actions: {
        readFiles: true,
        readFilesExternally: false,
        editFiles: false,
        editFilesExternally: false,
        executeSafeCommands: false,
        executeAllCommands: false,
        useBrowser: false,
        useMcp: false,
      },
      enableNotifications: true,
    });

    const manager = new AutoApproveManager(context);
    expect(manager.getSettings().yoloMode).toBe(false);
  });

  it('auto-approves every tool when yoloMode is enabled', async () => {
    const manager = new AutoApproveManager(context);
    await manager.setSettings({
      ...manager.getSettings(),
      yoloMode: true,
    });

    const result = await manager.shouldAutoApprove('totally_unknown_tool', {});
    expect(result).toBe(true);
  });

  it('auto-approves always-safe tools even when all flags are disabled', async () => {
    const manager = new AutoApproveManager(context);
    await manager.setSettings({
      ...manager.getSettings(),
      yoloMode: false,
      actions: {
        readFiles: false,
        readFilesExternally: false,
        editFiles: false,
        editFilesExternally: false,
        executeSafeCommands: false,
        executeAllCommands: false,
        useBrowser: false,
        useMcp: false,
      },
    });

    const handoverResult = await manager.shouldAutoApprove('handover_to_coder', {});
    const createPlanResult = await manager.shouldAutoApprove('create_plan', {});
    expect(handoverResult).toBe(true);
    expect(createPlanResult).toBe(true);
  });

  it('maps restore_checkpoint to editFiles policy', async () => {
    const manager = new AutoApproveManager(context);
    await manager.setSettings({
      ...manager.getSettings(),
      actions: {
        ...manager.getSettings().actions,
        editFiles: true,
        editFilesExternally: false,
      },
    });

    const result = await manager.shouldAutoApprove('restore_checkpoint', {});
    expect(result).toBe(true);
  });

  it('uses filename for update_memory_bank path classification', async () => {
    const manager = new AutoApproveManager(context);
    await manager.setSettings({
      ...manager.getSettings(),
      actions: {
        ...manager.getSettings().actions,
        editFiles: true,
        editFilesExternally: false,
      },
    });

    const internalResult = await manager.shouldAutoApprove('update_memory_bank', {
      filename: '.gently/memory-bank/notes.md',
    });
    const externalResult = await manager.shouldAutoApprove('update_memory_bank', {
      filename: '..\\outside\\notes.md',
    });

    expect(internalResult).toBe(true);
    expect(externalResult).toBe(false);
  });

  it('treats relative paths as external when no workspace is open', async () => {
    const manager = new AutoApproveManager(context);
    await manager.setSettings({
      ...manager.getSettings(),
      actions: {
        ...manager.getSettings().actions,
        editFiles: true,
        editFilesExternally: false,
      },
    });

    mockVscode.workspace.workspaceFolders = [];
    const result = await manager.shouldAutoApprove('write_file', { path: 'src/app.ts' });

    expect(result).toBe(false);
  });

  it('requires approval for unknown tools when yoloMode is off', async () => {
    const manager = new AutoApproveManager(context);
    const result = await manager.shouldAutoApprove('unknown_new_tool', {});
    expect(result).toBe(false);
  });
});

describe('ApprovalManager', () => {
  const context = {
    globalState: {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined)
    }
  } as any;

  let sentMessages: any[];
  let manager: ApprovalManager;

  beforeEach(() => {
    sentMessages = [];
    manager = new ApprovalManager(context, (message: any) => {
      sentMessages.push(message);
    });
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  it('classifies safe, moderate and risky commands deterministically', () => {
    expect(manager.evaluateCommandSafety('git status').safetyLevel).toBe('safe');
    expect(manager.evaluateCommandSafety('npm install').safetyLevel).toBe('moderate');
    expect(manager.evaluateCommandSafety('rm -rf node_modules').safetyLevel).toBe('risky');
  });

  it('auto-rejects command approvals after timeout', async () => {
    vi.useFakeTimers();
    const pending = manager.requestApproval({
      commandId: 'cmd_timeout',
      command: 'npm run build',
      cwd: 'C:\\repo',
      reason: 'build',
      safetyLevel: 'moderate',
      timestamp: Date.now()
    });

    expect(sentMessages[0]?.type).toBe('approvalRequest');
    expect(sentMessages[0]?.request?.timeoutMs).toBe(90_000);
    expect(sentMessages[0]?.request?.expiresAt).toBeTypeOf('number');

    await vi.advanceTimersByTimeAsync(90_000);
    await expect(pending).resolves.toBe(false);
    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: 'commandApprovalResolved',
        commandId: 'cmd_timeout',
        status: 'rejected',
        reason: 'approval_timeout',
        source: 'system'
      })
    );
  });

  it('ignores stale approval responses after timeout settlement', async () => {
    vi.useFakeTimers();
    const pending = manager.requestApproval({
      commandId: 'cmd_stale',
      command: 'npm run lint',
      cwd: 'C:\\repo',
      reason: 'lint',
      safetyLevel: 'moderate',
      timestamp: Date.now()
    });

    await vi.advanceTimersByTimeAsync(90_000);
    await expect(pending).resolves.toBe(false);

    expect(() => manager.handleApprovalResponse('cmd_stale', 'accept')).not.toThrow();
  });

  it('rejects invalid approval payloads deterministically', async () => {
    const pending = manager.requestApproval({
      commandId: 'cmd_invalid',
      command: 'npm run typecheck',
      cwd: 'C:\\repo',
      reason: 'typecheck',
      safetyLevel: 'moderate',
      timestamp: Date.now()
    });

    manager.handleApprovalResponse('cmd_invalid', { unexpected: true });
    await expect(pending).resolves.toBe(false);
    expect(sentMessages).toContainEqual(
      expect.objectContaining({
        type: 'commandApprovalResolved',
        commandId: 'cmd_invalid',
        status: 'rejected',
        reason: 'invalid_response',
        source: 'system'
      })
    );
  });
});
