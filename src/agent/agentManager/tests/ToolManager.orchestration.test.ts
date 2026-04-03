import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../ToolManager';

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

function createToolManager(options?: {
  toolExecute?: any;
  preHookResult?: any;
  postHookResult?: any;
  notificationResult?: any;
  autoApproved?: boolean;
}) {
  const toolExecute = options?.toolExecute ?? vi.fn().mockResolvedValue({ ok: true });
  const tool = { execute: toolExecute };
  const toolRegistry = {
    get: vi.fn().mockReturnValue(tool)
  } as any;

  const hookManager = {
    executePreHooks: vi.fn().mockImplementation(async (_toolName: string, params: any) => (
      options?.preHookResult ?? { blocked: false, modifiedParams: params }
    )),
    executePostHooks: vi.fn().mockResolvedValue(options?.postHookResult ?? { failures: [] }),
    executeNotification: vi.fn().mockResolvedValue(options?.notificationResult ?? { failures: [] })
  } as any;

  const circuitBreakers = {
    canExecute: vi.fn().mockReturnValue({
      key: 'tool.execute',
      decision: { allowed: true, state: 'closed' },
      transition: undefined
    }),
    recordSuccess: vi.fn().mockReturnValue({
      key: 'tool.execute',
      transition: undefined
    }),
    recordFailure: vi.fn().mockReturnValue({
      key: 'tool.execute',
      transition: undefined
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
    { shouldAutoApprove: vi.fn().mockResolvedValue(options?.autoApproved ?? true) } as any,
    hookManager,
    circuitBreakers
  );

  const events: any[] = [];
  manager.setEventCallback((event: any) => {
    events.push(event);
  });

  return { manager, events, hookManager, toolExecute };
}

describe('ToolManager R2 orchestration', () => {
  beforeEach(() => {
    for (const key of Object.keys(configValues)) {
      delete configValues[key];
    }
    configValues['resilience.killSwitch'] = false;
    configValues['resilience.errorContractV1'] = true;
    configValues['resilience.toolOrchestratorV2'] = true;
    configValues['resilience.hookContractV2'] = true;
    configValues['resilience.toolTelemetryV2'] = true;
  });

  it('retries recoverable tool execution failures with deterministic status emission', async () => {
    const toolExecute = vi
      .fn()
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({ ok: true });
    const { manager, events } = createToolManager({ toolExecute });

    const result = await manager.executeTool('read_file', { path: 'README.md' }, { flowId: 'flow-1', toolCallId: 'tc-1' });

    expect(result).toEqual({ ok: true });
    expect(toolExecute).toHaveBeenCalledTimes(2);
    const retryStatus = events.find((event) => event.type === 'resilienceStatus' && event.code === 'TOOL_RETRY_SCHEDULED');
    expect(retryStatus).toBeTruthy();
    expect(retryStatus.attempt).toBe(2);
    expect(retryStatus.maxAttempts).toBe(3);
  });

  it('does not retry when pre-hook blocks execution (fail-closed)', async () => {
    const { manager, events, hookManager, toolExecute } = createToolManager({
      preHookResult: {
        blocked: true,
        reason: 'Blocked by policy',
        code: 'HOOK_PRE_BLOCKED',
        hookName: 'pre-policy'
      }
    });

    await expect(manager.executeTool('write_file', { path: 'a.txt' }, { flowId: 'flow-2', toolCallId: 'tc-2' }))
      .rejects
      .toThrow('Blocked by policy');

    expect(toolExecute).not.toHaveBeenCalled();
    expect(hookManager.executePreHooks).toHaveBeenCalledTimes(1);
    const retryStatuses = events.filter((event) => event.type === 'resilienceStatus' && event.code === 'TOOL_RETRY_SCHEDULED');
    expect(retryStatuses).toHaveLength(0);
    const terminalStatus = events.find((event) => event.type === 'resilienceStatus' && event.code === 'HOOK_PRE_BLOCKED');
    expect(terminalStatus).toBeTruthy();
  });

  it('keeps successful tool result when post-hook fails (fail-open)', async () => {
    const { manager, events } = createToolManager({
      postHookResult: {
        failures: [{ code: 'HOOK_POST_FAILED', hookName: 'post-audit', message: 'audit failed' }]
      }
    });

    const result = await manager.executeTool('read_file', { path: 'README.md' }, { flowId: 'flow-3', toolCallId: 'tc-3' });

    expect(result).toEqual({ ok: true });
    const postFailureStatus = events.find((event) => event.type === 'resilienceStatus' && event.code === 'HOOK_POST_FAILED');
    expect(postFailureStatus).toBeTruthy();
    expect(postFailureStatus.category).toBe('hook');
  });

  it('falls back to legacy tool path when killSwitch is enabled', async () => {
    configValues['resilience.killSwitch'] = true;
    const { manager, hookManager } = createToolManager();

    const result = await manager.executeTool('read_file', { path: 'README.md' }, { flowId: 'flow-legacy', toolCallId: 'tc-legacy' });

    expect(result).toEqual({ ok: true });
    expect(hookManager.executePreHooks).toHaveBeenCalledTimes(1);
    expect(hookManager.executePreHooks.mock.calls[0]).toHaveLength(2);
  });
});
