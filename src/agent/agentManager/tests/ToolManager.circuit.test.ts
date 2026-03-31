import { describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../ToolManager';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback?: unknown) => fallback
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

describe('ToolManager circuit transition notifications', () => {
  it('emits half_open and closed notifications during successful execution', async () => {
    const executeNotification = vi.fn().mockResolvedValue(undefined);
    const hookManager = {
      executePreHooks: vi.fn().mockResolvedValue({ blocked: false, modifiedParams: { path: 'README.md' } }),
      executePostHooks: vi.fn().mockResolvedValue(undefined),
      executeNotification
    } as any;

    const tool = {
      execute: vi.fn().mockResolvedValue({ success: true })
    };
    const toolRegistry = {
      get: vi.fn().mockReturnValue(tool)
    } as any;

    const circuitBreakers = {
      canExecute: vi.fn().mockReturnValue({
        key: 'tool.execute',
        decision: { allowed: true, state: 'HALF_OPEN' },
        transition: 'half_open'
      }),
      recordSuccess: vi.fn().mockReturnValue({
        key: 'tool.execute',
        transition: 'closed'
      }),
      recordFailure: vi.fn().mockReturnValue({
        key: 'tool.execute',
        tripped: false
      })
    } as any;

    const manager = new ToolManager(
      toolRegistry,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { shouldAutoApprove: vi.fn().mockResolvedValue(true) } as any,
      hookManager,
      circuitBreakers
    );

    await manager.executeTool('read_file', { path: 'README.md' });

    expect(executeNotification).toHaveBeenCalledTimes(2);
    expect(executeNotification).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'circuit_breaker',
      severity: 'warning',
      action: 'retry'
    }));
    expect(executeNotification).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'circuit_breaker',
      severity: 'info'
    }));
  });
});
