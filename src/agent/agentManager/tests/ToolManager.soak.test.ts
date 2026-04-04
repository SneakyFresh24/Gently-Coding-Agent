import { describe, expect, it, vi } from 'vitest';
import { ToolManager } from '../ToolManager';
import {
  buildR4SuiteReport,
  countReplayMismatches,
  createDeterministicFaultPlan,
  normalizeReplaySnapshot,
  writeR4SuiteReport
} from '../../../core/resilience/R4SoakHarness';

const configValues: Record<string, unknown> = {  'resilience.toolOrchestratorV2': true,
  'resilience.hookContractV2': true,
  'resilience.toolTelemetryV2': false
};

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

const TOTAL_FLOWS = 1000;
const TOOL_FAULT_SEED = 52013;
const TOOL_FAULT_CATALOG = [
  'baseline_success',
  'recoverable_exec_error',
  'prehook_block',
  'posthook_fail_open',
  'permission_denied_terminal',
  'tool_invalid_terminal',
  'mixed_fault_chain'
] as const;

type ToolFaultScenario = typeof TOOL_FAULT_CATALOG[number];

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout_after_${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function createManager() {
  const attemptByPath = new Map<string, number>();

  const readScenarioFromPath = (path: string): ToolFaultScenario => {
    const match = path.match(/scenario-([a-z_]+)-/);
    if (!match) return 'baseline_success';
    const candidate = match[1] as ToolFaultScenario;
    if (TOOL_FAULT_CATALOG.includes(candidate)) {
      return candidate;
    }
    return 'baseline_success';
  };

  const tool = {
    execute: vi.fn().mockImplementation(async (params: { path: string }) => {
      const scenario = readScenarioFromPath(params.path);
      const key = params.path;
      const attempts = (attemptByPath.get(key) || 0) + 1;
      attemptByPath.set(key, attempts);

      if (scenario === 'recoverable_exec_error' && attempts === 1) {
        throw new Error('network timeout');
      }
      if (scenario === 'mixed_fault_chain' && attempts === 1) {
        throw new Error('temporary network failure');
      }
      if (scenario === 'permission_denied_terminal') {
        throw new Error('permission denied');
      }
      return { ok: true, path: params.path, attempts };
    })
  };

  const toolRegistry = {
    get: vi.fn().mockImplementation((toolName: string) => (toolName === 'read_file' ? tool : null))
  } as any;

  const hookManager = {
    executePreHooks: vi.fn().mockImplementation(async (_toolName: string, params: any) => {
      const scenario = readScenarioFromPath(String(params?.path || ''));
      if (scenario === 'prehook_block') {
        return {
          blocked: true,
          reason: 'blocked by pre-hook policy',
          code: 'HOOK_PRE_BLOCKED',
          hookName: 'policy-hook'
        };
      }
      return { blocked: false, modifiedParams: params };
    }),
    executePostHooks: vi.fn().mockImplementation(async (_toolName: string, params: any) => {
      const scenario = readScenarioFromPath(String(params?.path || ''));
      if (scenario === 'posthook_fail_open' || scenario === 'mixed_fault_chain') {
        return {
          failures: [{ code: 'HOOK_POST_FAILED', hookName: 'audit-hook', message: 'post-hook failed' }]
        };
      }
      return { failures: [] };
    }),
    executeNotification: vi.fn().mockResolvedValue({ failures: [] })
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
    { shouldAutoApprove: vi.fn().mockResolvedValue(true) } as any,
    hookManager,
    circuitBreakers
  );

  const statuses: any[] = [];
  manager.setEventCallback((event: any) => {
    if (event?.type === 'resilienceStatus') {
      statuses.push(event);
    }
  });

  vi.spyOn(manager as any, 'sleep').mockResolvedValue(undefined);
  return { manager, statuses };
}

function terminalStatusForFlow(statuses: any[], flowId: string): { code: string | null; action: string | null } {
  const flowStatuses = statuses.filter((status) => status.flowId === flowId);
  for (let i = flowStatuses.length - 1; i >= 0; i -= 1) {
    const status = flowStatuses[i];
    const isTerminal = status.phase === 'terminal' || status.severity === 'error';
    if (isTerminal && typeof status.code === 'string') {
      return {
        code: status.code,
        action: typeof status.action === 'string' ? status.action : null
      };
    }
  }
  return { code: null, action: null };
}

async function runPass(faultPlan: ToolFaultScenario[]) {
  const { manager, statuses } = createManager();
  let silentAborts = 0;
  let stuckStates = 0;
  let terminalFailures = 0;
  let terminalFailuresWithCodeAndAction = 0;
  let retryableRecoveryTotal = 0;
  let retryableRecoverySucceeded = 0;
  const outcomes: unknown[] = [];

  for (let i = 0; i < faultPlan.length; i += 1) {
    const scenario = faultPlan[i];
    const flowId = `tool-soak-flow-${i}`;
    const path = `scenario-${scenario}-file-${i}.txt`;
    const retryable = scenario === 'recoverable_exec_error' || scenario === 'mixed_fault_chain';
    if (retryable) {
      retryableRecoveryTotal += 1;
    }

    const toolName = scenario === 'tool_invalid_terminal' ? 'unknown_tool_name' : 'read_file';
    let resolved = false;
    let timedOut = false;
    try {
      await withTimeout(
        manager.executeTool(toolName, { path }, { flowId, toolCallId: `tc-${i}` }),
        3000
      );
      resolved = true;
    } catch (error) {
      resolved = false;
      timedOut = error instanceof Error && error.message.startsWith('timeout_after_');
    }

    if (timedOut) {
      stuckStates += 1;
    }

    const terminal = terminalStatusForFlow(statuses, flowId);
    if (!resolved) {
      terminalFailures += 1;
      if (terminal.code && terminal.action) {
        terminalFailuresWithCodeAndAction += 1;
      } else {
        silentAborts += 1;
      }
    }

    if (retryable && resolved) {
      retryableRecoverySucceeded += 1;
    }

    outcomes.push(normalizeReplaySnapshot({
      scenario,
      resolved,
      timedOut,
      terminalCode: terminal.code,
      terminalAction: terminal.action
    }));
  }

  return {
    totalFlows: faultPlan.length,
    silentAborts,
    stuckStates,
    terminalFailures,
    terminalFailuresWithCodeAndAction,
    retryableRecoveryTotal,
    retryableRecoverySucceeded,
    outcomes
  };
}

describe('ToolManager R4 hardening soak gate', () => {
  it('enforces R4 SLOs with deterministic tool chaos replay over 1000 flows', async () => {
    const faultPlan = createDeterministicFaultPlan(TOTAL_FLOWS, [...TOOL_FAULT_CATALOG], TOOL_FAULT_SEED) as ToolFaultScenario[];
    const firstRun = await runPass(faultPlan);
    const replayRun = await runPass(faultPlan);
    const replayMismatchCount = countReplayMismatches(firstRun.outcomes, replayRun.outcomes);

    const report = buildR4SuiteReport({
      suite: 'tool',
      totalFlows: firstRun.totalFlows,
      silentAborts: firstRun.silentAborts,
      stuckStates: firstRun.stuckStates,
      terminalFailures: firstRun.terminalFailures,
      terminalFailuresWithCodeAndAction: firstRun.terminalFailuresWithCodeAndAction,
      retryableRecoveryTotal: firstRun.retryableRecoveryTotal,
      retryableRecoverySucceeded: firstRun.retryableRecoverySucceeded,
      replayMismatchCount
    });
    writeR4SuiteReport(report);

    expect(report.silentAborts).toBe(0);
    expect(report.stuckStates).toBe(0);
    expect(report.terminalCoverage).toBeGreaterThanOrEqual(0.999);
    expect(report.recoveryRate).toBeGreaterThanOrEqual(0.95);
    expect(report.replayMismatchCount).toBe(0);
    expect(report.pass).toBe(true);
  }, 90_000);
});
