import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HookManager } from './HookManager';

const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (key in configValues ? configValues[key] : fallback)
    })
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => {},
      show: () => {},
      clear: () => {},
      dispose: () => {}
    })
  }
}));

function createManager(): HookManager {
  const manager = new HookManager('C:\\workspace');
  (manager as any).hooksInitialized = true;
  return manager;
}

describe('HookManager R2 contract', () => {
  beforeEach(() => {
    for (const key of Object.keys(configValues)) {
      delete configValues[key];
    }
    configValues['hooks.timeoutMs'] = 5000;
    configValues['hooks.maxMemoryMB'] = 64;
    configValues['hooks.catchErrors'] = true;
    configValues['hooks.logFailures'] = false;
    configValues['resilience.killSwitch'] = false;
    configValues['resilience.hookContractV2'] = true;
  });

  it('fails closed for pre-hook failures when hookContractV2 is enabled', async () => {
    const manager = createManager();
    (manager as any).preToolHooks = [
      {
        name: 'pre-throws',
        execute: vi.fn().mockRejectedValue(new Error('boom'))
      }
    ];

    const result = await manager.executePreHooks('write_file', { path: 'a.txt' });

    expect(result.blocked).toBe(true);
    expect(result.code).toBe('HOOK_PRE_FAILED');
    expect(result.hookName).toBe('pre-throws');
    expect(result.reason).toContain('boom');
  });

  it('keeps fail-open behavior for pre-hook failures when hookContractV2 is disabled', async () => {
    configValues['resilience.hookContractV2'] = false;
    const manager = createManager();
    (manager as any).preToolHooks = [
      {
        name: 'pre-throws',
        execute: vi.fn().mockRejectedValue(new Error('boom'))
      }
    ];

    const result = await manager.executePreHooks('read_file', { path: 'README.md' });

    expect(result.blocked).toBe(false);
    expect(result.modifiedParams).toEqual({ path: 'README.md' });
  });

  it('treats post-hook failures as fail-open and reports stable failure codes', async () => {
    const manager = createManager();
    (manager as any).postToolHooks = [
      {
        name: 'post-throws',
        execute: vi.fn().mockRejectedValue(new Error('post failed'))
      }
    ];

    const result = await manager.executePostHooks('read_file', { path: 'README.md' }, { ok: true });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      code: 'HOOK_POST_FAILED',
      hookName: 'post-throws'
    });
  });

  it('treats notification-hook failures as fail-open and reports stable failure codes', async () => {
    const manager = createManager();
    (manager as any).notificationHooks = [
      {
        name: 'notify-throws',
        execute: vi.fn().mockRejectedValue(new Error('notify failed'))
      }
    ];

    const result = await manager.executeNotification({
      channel: 'recovery',
      severity: 'warning',
      action: 'retry',
      message: 'retrying'
    });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      code: 'HOOK_NOTIFICATION_FAILED',
      hookName: 'notify-throws'
    });
  });
});
