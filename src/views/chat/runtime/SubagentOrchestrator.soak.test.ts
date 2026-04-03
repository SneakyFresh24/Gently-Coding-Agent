import { describe, expect, it, vi } from 'vitest';
import { ChatViewContext } from '../types/ChatTypes';
import { SubagentOrchestrator, SubagentResilienceSettings } from './SubagentOrchestrator';
import {
  buildR4SuiteReport,
  countReplayMismatches,
  createDeterministicFaultPlan,
  normalizeReplaySnapshot,
  writeR4SuiteReport
} from '../../../core/resilience/R4SoakHarness';

const settings: SubagentResilienceSettings = {
  killSwitch: false,
  subagentOrchestratorV1: true,
  subagentErrorContractV1: true,
  subagentTelemetryV1: false
};

const TOTAL_FLOWS = 1000;
const SUBAGENT_FAULT_SEED = 73019;
const SUBAGENT_FAULT_CATALOG = [
  'baseline_success',
  'mode_switch_recoverable',
  'worker_start_recoverable',
  'prehook_block',
  'posthook_fail_open',
  'user_stop',
  'plan_missing_terminal',
  'mixed_fault_chain'
] as const;

type SubagentFaultScenario = typeof SUBAGENT_FAULT_CATALOG[number];

function createContext(flowId: string): ChatViewContext {
  return {
    agentMode: false,
    selectedModel: 'openai/gpt-4o-mini',
    selectedMode: 'architect',
    conversationHistory: [],
    shouldStopStream: false,
    shouldAbortTools: false,
    currentFlowId: flowId,
    messageCheckpoints: new Map(),
    toolExecutionStartSent: new Set()
  };
}

function terminalStatusFromSubagentEvents(events: any[]): { code: string | null; action: string | null } {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'subagentStatus' && typeof event.code === 'string') {
      const terminalCode = event.code === 'SUBAGENT_SUMMARY_READY' || event.code === 'SUBAGENT_STOPPED'
        ? null
        : event.code;
      if (terminalCode) {
        return {
          code: terminalCode,
          action: typeof event.action === 'string' ? event.action : null
        };
      }
    }
  }
  return { code: null, action: null };
}

async function runPass(faultPlan: SubagentFaultScenario[]) {
  let silentAborts = 0;
  let stuckStates = 0;
  let terminalFailures = 0;
  let terminalFailuresWithCodeAndAction = 0;
  let retryableRecoveryTotal = 0;
  let retryableRecoverySucceeded = 0;
  const outcomes: unknown[] = [];

  for (let i = 0; i < faultPlan.length; i += 1) {
    const scenario = faultPlan[i];
    const flowId = `subagent-soak-${i}`;
    const context = createContext(flowId);
    const sendMessageToWebview = vi.fn();
    const modeSwitchAttempts = new Map<string, number>();
    const workerAttempts = new Map<string, number>();

    if (scenario === 'mode_switch_recoverable' || scenario === 'worker_start_recoverable' || scenario === 'mixed_fault_chain') {
      retryableRecoveryTotal += 1;
    }
    if (scenario === 'user_stop') {
      context.shouldStopStream = true;
    }

    const orchestrator = new SubagentOrchestrator({
      hookManager: {
        executePreHooks: vi.fn(async (_name: string, params: any) => {
          if (scenario === 'prehook_block') {
            return {
              blocked: true,
              reason: 'blocked by test prehook',
              code: 'HOOK_PRE_BLOCKED',
              modifiedParams: params
            };
          }
          return { blocked: false, modifiedParams: params };
        }),
        executePostHooks: vi.fn(async () => {
          if (scenario === 'posthook_fail_open' || scenario === 'mixed_fault_chain') {
            return {
              failures: [{ code: 'HOOK_POST_FAILED', hookName: 'audit-hook', message: 'audit failed' }]
            };
          }
          return { failures: [] };
        }),
        executeNotification: vi.fn(async () => ({ failures: [] }))
      } as any,
      sendMessageToWebview,
      performModeSwitch: async (modeId: string) => {
        const key = flowId;
        const attempts = (modeSwitchAttempts.get(key) || 0) + 1;
        modeSwitchAttempts.set(key, attempts);
        if ((scenario === 'mode_switch_recoverable' || scenario === 'mixed_fault_chain') && attempts === 1) {
          throw new Error('network timeout during mode switch');
        }
        context.selectedMode = modeId;
      },
      sendContinuationMessage: async () => {
        const key = flowId;
        const attempts = (workerAttempts.get(key) || 0) + 1;
        workerAttempts.set(key, attempts);
        if ((scenario === 'worker_start_recoverable' || scenario === 'mixed_fault_chain') && attempts === 1) {
          throw new Error('temporary network issue while starting worker');
        }
      },
      hasPersistedPlan: () => scenario !== 'plan_missing_terminal',
      getSettings: () => settings,
      sleep: async () => undefined
    });

    const consumed = await orchestrator.runArchitectToCoder(context, {
      sourceToolName: 'handover_to_coder',
      requestedMode: 'code',
      continuationPrompt: 'start coding now'
    });
    expect(consumed).toBe(true);

    const events = sendMessageToWebview.mock.calls.map((call) => call[0] as any);
    const subagentStatuses = events.filter((event) => event?.type === 'subagentStatus');

    const hasSummary = subagentStatuses.some((event) => event.code === 'SUBAGENT_SUMMARY_READY');
    const hasStopped = subagentStatuses.some((event) => event.code === 'SUBAGENT_STOPPED');
    const hasLeakBlock = subagentStatuses.some((event) =>
      event.code === 'SUBAGENT_PREFLIGHT_BLOCKED' && String(event.reason || '').includes('subagent_already_active')
    );
    if (hasLeakBlock) {
      stuckStates += 1;
    }

    const terminal = terminalStatusFromSubagentEvents(subagentStatuses);
    const resolved = hasSummary || hasStopped;

    if (!resolved && !terminal.code) {
      silentAborts += 1;
    }

    if (terminal.code) {
      terminalFailures += 1;
      if (terminal.action) {
        terminalFailuresWithCodeAndAction += 1;
      }
    }

    if (
      (scenario === 'mode_switch_recoverable' || scenario === 'worker_start_recoverable' || scenario === 'mixed_fault_chain')
      && hasSummary
    ) {
      retryableRecoverySucceeded += 1;
    }

    outcomes.push(normalizeReplaySnapshot({
      scenario,
      hasSummary,
      hasStopped,
      terminalCode: terminal.code,
      terminalAction: terminal.action,
      hasLeakBlock
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

describe('SubagentOrchestrator R4 hardening soak gate', () => {
  it('enforces R4 SLOs with deterministic subagent chaos replay over 1000 flows', async () => {
    const faultPlan = createDeterministicFaultPlan(TOTAL_FLOWS, [...SUBAGENT_FAULT_CATALOG], SUBAGENT_FAULT_SEED) as SubagentFaultScenario[];
    const firstRun = await runPass(faultPlan);
    const replayRun = await runPass(faultPlan);
    const replayMismatchCount = countReplayMismatches(firstRun.outcomes, replayRun.outcomes);

    const report = buildR4SuiteReport({
      suite: 'subagent',
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
