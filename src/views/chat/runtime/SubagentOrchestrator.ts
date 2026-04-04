import { ChatViewContext } from '../types/ChatTypes';
import {
  OutboundWebviewMessage,
  ResilienceStatusAction,
  SubagentStatusCategory,
  SubagentStatusCode,
  SubagentStatusDecision,
  SubagentStatusPhase
} from '../types/WebviewMessageTypes';
import { HookFailure, NotificationPayload } from '../../../hooks/types';
import { LogService } from '../../../services/LogService';
import { getModeContractViolation } from '../../../modes/ModeContractV2';
import { SubagentRetryPolicyEngine } from './SubagentRetryPolicyEngine';
import { SubagentRunStateMachine } from './SubagentRunStateMachine';
import { sleepWithAbort } from '../../../core/resilience/RetryDelayUtils';

const log = new LogService('SubagentOrchestrator');

export interface SubagentResilienceSettings {
  subagentOrchestratorV1: boolean;
  subagentErrorContractV1: boolean;
  subagentTelemetryV1: boolean;
}

export interface SubagentRunRequest {
  sourceToolName?: string;
  requestedMode?: string;
  continuationPrompt?: string;
}

interface HookManagerLike {
  executePreHooks(
    toolName: string,
    params: any,
    context?: Record<string, unknown>
  ): Promise<{ blocked: boolean; reason?: string; modifiedParams: any; code?: 'HOOK_PRE_BLOCKED' | 'HOOK_PRE_FAILED'; hookName?: string }>;
  executePostHooks(
    toolName: string,
    params: any,
    result: any,
    context?: Record<string, unknown>
  ): Promise<{ failures: HookFailure[] }>;
  executeNotification(
    payload: NotificationPayload,
    context?: Record<string, unknown>
  ): Promise<{ failures: HookFailure[] }>;
}

interface SubagentOrchestratorDeps {
  hookManager: HookManagerLike;
  sendMessageToWebview: (message: OutboundWebviewMessage) => void;
  performModeSwitch: (modeId: string) => Promise<void>;
  sendContinuationMessage: (message: string) => Promise<void>;
  hasPersistedPlan: () => boolean;
  getSettings: () => SubagentResilienceSettings;
  sleep?: (ms: number) => Promise<void>;
}

export class SubagentOrchestrator {
  private activeSubagentId: string | null = null;
  private readonly retryPolicy = new SubagentRetryPolicyEngine();

  constructor(private readonly deps: SubagentOrchestratorDeps) {}

  async runArchitectToCoder(context: ChatViewContext, request: SubagentRunRequest): Promise<boolean> {
    if (request.sourceToolName !== 'handover_to_coder' || request.requestedMode !== 'code') {
      return false;
    }

    const settings = this.deps.getSettings();
    if (!settings.subagentOrchestratorV1) {
      return false;
    }

    const flowId = context.currentFlowId || `flow-${Date.now()}`;
    const model = context.selectedModel || 'unknown';
    const modeFrom = context.selectedMode || 'unknown';
    const modeTo = 'code';
    const subagentId = `subagent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const correlationId = `${flowId}:${subagentId}`;
    const machine = new SubagentRunStateMachine();
    const maxAttempts = this.retryPolicy.getBudgets().mode_switch_recoverable;

    if (this.activeSubagentId) {
      this.emitStatus(settings, {
        code: 'SUBAGENT_PREFLIGHT_BLOCKED',
        category: 'subagent',
        severity: 'error',
        retryable: false,
        attempt: 1,
        maxAttempts,
        model,
        flowId,
        subagentId,
        userMessage: 'Subagent run blocked because another subagent is already active.',
        action: 'retry',
        phase: 'preflight',
        decision: 'abort',
        reason: 'subagent_already_active',
        correlationId
      });
      this.emitLegacyError('Subagent run blocked because another subagent is already active.', 'SUBAGENT_PREFLIGHT_BLOCKED', 'retry');
      return true;
    }

    this.activeSubagentId = subagentId;

    let terminalized = false;

    try {
      machine.transition('PREFLIGHT', 'start');
      this.emitStatus(settings, {
        code: 'SUBAGENT_START',
        category: 'subagent',
        severity: 'info',
        retryable: false,
        attempt: 1,
        maxAttempts,
        model,
        flowId,
        subagentId,
        userMessage: 'Starting architect-to-coder handover.',
        action: 'none',
        phase: 'preflight',
        decision: 'report',
        reason: 'handover_triggered',
        correlationId
      });

      if (this.isStopped(context)) {
        this.handleStopped(settings, machine, {
          flowId,
          subagentId,
          model,
          correlationId,
          phase: 'preflight'
        });
        terminalized = true;
        return true;
      }

      if (modeFrom !== 'architect') {
        this.failPreflight(settings, machine, {
          flowId,
          subagentId,
          model,
          correlationId,
          reason: `handover_requires_architect_mode:${modeFrom}`
        });
        terminalized = true;
        return true;
      }

      if (!this.deps.hasPersistedPlan()) {
        this.failPreflight(settings, machine, {
          flowId,
          subagentId,
          model,
          correlationId,
          reason: 'missing_persisted_plan'
        });
        terminalized = true;
        return true;
      }

      const modeViolation = getModeContractViolation(modeFrom, 'handover_to_coder');
      if (modeViolation) {
        this.failPreflight(settings, machine, {
          flowId,
          subagentId,
          model,
          correlationId,
          reason: modeViolation
        });
        terminalized = true;
        return true;
      }

      const preHandoverHook = await this.deps.hookManager.executePreHooks(
        'subagent_pre_handover',
        { modeFrom, modeTo, flowId, subagentId },
        {
          flowId,
          correlationId,
          subagentId,
          attempt: 1,
          phase: 'PreHandover',
          mode: modeFrom
        }
      );

      if (preHandoverHook.blocked) {
        const blockedCode: SubagentStatusCode =
          preHandoverHook.code === 'HOOK_PRE_BLOCKED' ? 'SUBAGENT_PREHOOK_BLOCKED' : 'SUBAGENT_PREHOOK_FAILED';
        this.emitStatus(settings, {
          code: blockedCode,
          category: 'hook',
          severity: 'error',
          retryable: false,
          attempt: 1,
          maxAttempts,
          model,
          flowId,
          subagentId,
          userMessage: preHandoverHook.reason || 'Subagent handover blocked by pre-hook.',
          action: 'none',
          phase: 'preflight',
          decision: 'abort',
          reason: preHandoverHook.code || 'prehook_blocked',
          correlationId
        });
        this.emitLegacyError(preHandoverHook.reason || 'Subagent handover blocked by pre-hook.', blockedCode, 'none');
        this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
          flowId,
          correlationId,
          subagentId,
          code: blockedCode,
          modeFrom,
          modeTo,
          model,
          attempt: 1
        });
        machine.terminalize('failed', 'prehook_blocked');
        terminalized = true;
        return true;
      }

      machine.transition('MODE_SWITCH', 'mode_switch_start');
      const modeSwitchSuccess = await this.runModeSwitchWithRetry(context, settings, {
        flowId,
        subagentId,
        correlationId,
        model,
        modeFrom,
        modeTo
      });
      if (!modeSwitchSuccess) {
        machine.terminalize('failed', 'mode_switch_failed');
        terminalized = true;
        return true;
      }

      const preSpawnHook = await this.deps.hookManager.executePreHooks(
        'subagent_pre_spawn',
        { modeFrom, modeTo, flowId, subagentId },
        {
          flowId,
          correlationId,
          subagentId,
          attempt: 1,
          phase: 'PreSpawn',
          mode: modeTo
        }
      );

      if (preSpawnHook.blocked) {
        const blockedCode: SubagentStatusCode =
          preSpawnHook.code === 'HOOK_PRE_BLOCKED' ? 'SUBAGENT_PREHOOK_BLOCKED' : 'SUBAGENT_PREHOOK_FAILED';
        this.emitStatus(settings, {
          code: blockedCode,
          category: 'hook',
          severity: 'error',
          retryable: false,
          attempt: 1,
          maxAttempts,
          model,
          flowId,
          subagentId,
          userMessage: preSpawnHook.reason || 'Subagent worker start blocked by pre-hook.',
          action: 'none',
          phase: 'mode_switch',
          decision: 'abort',
          reason: preSpawnHook.code || 'prehook_blocked',
          correlationId
        });
        this.emitLegacyError(preSpawnHook.reason || 'Subagent worker start blocked by pre-hook.', blockedCode, 'none');
        this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
          flowId,
          correlationId,
          subagentId,
          code: blockedCode,
          modeFrom,
          modeTo,
          model,
          attempt: 1
        });
        machine.terminalize('failed', 'pre_spawn_blocked');
        terminalized = true;
        return true;
      }

      machine.transition('WORKER_RUN', 'worker_run_start');
      const workerStartSuccess = await this.runWorkerStartWithRetry(context, settings, {
        flowId,
        subagentId,
        correlationId,
        model,
        modeFrom,
        modeTo,
        continuationPrompt: request.continuationPrompt || 'Implement the approved plan step by step. Start with step 1.'
      });
      if (!workerStartSuccess) {
        machine.terminalize('failed', 'worker_start_failed');
        terminalized = true;
        return true;
      }

      machine.transition('MERGE_SUMMARY', 'merge_summary');
      this.emitStatus(settings, {
        code: 'SUBAGENT_SUMMARY_READY',
        category: 'subagent',
        severity: 'info',
        retryable: false,
        attempt: 1,
        maxAttempts,
        model,
        flowId,
        subagentId,
        userMessage: 'Coder worker started. Continuing with implementation flow.',
        action: 'none',
        phase: 'merge_summary',
        decision: 'report',
        reason: 'worker_started',
        correlationId
      });

      const postHookResult = await this.deps.hookManager.executePostHooks(
        'subagent_post_handover',
        { modeFrom, modeTo, flowId, subagentId },
        { success: true },
        {
          flowId,
          correlationId,
          subagentId,
          attempt: 1,
          phase: 'PostHandover',
          mode: modeTo
        }
      );
      this.emitPostHookFailures(settings, postHookResult.failures, {
        flowId,
        subagentId,
        correlationId,
        model,
        modeFrom,
        modeTo,
        attempt: 1
      });

      machine.terminalize('completed', 'subagent_completed');
      terminalized = true;
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitStatus(settings, {
        code: 'SUBAGENT_TERMINAL_FAILED',
        category: 'subagent',
        severity: 'error',
        retryable: false,
        attempt: 1,
        maxAttempts,
        model,
        flowId,
        subagentId,
        userMessage: message,
        action: 'retry',
        phase: 'terminal',
        decision: 'abort',
        reason: 'orchestrator_exception',
        correlationId
      });
      this.emitLegacyError(message, 'SUBAGENT_TERMINAL_FAILED', 'retry');
      this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
        flowId,
        correlationId,
        subagentId,
        code: 'SUBAGENT_TERMINAL_FAILED',
        modeFrom,
        modeTo,
        model,
        attempt: 1
      });
      machine.terminalize('failed', 'orchestrator_exception');
      terminalized = true;
      return true;
    } finally {
      if (terminalized) {
        try {
          machine.ensureTerminalized();
        } catch (error) {
          log.error('Subagent run terminal invariant violation', error);
        }
      }
      this.activeSubagentId = null;
    }
  }

  private async runModeSwitchWithRetry(
    context: ChatViewContext,
    settings: SubagentResilienceSettings,
    args: {
      flowId: string;
      subagentId: string;
      correlationId: string;
      model: string;
      modeFrom: string;
      modeTo: string;
    }
  ): Promise<boolean> {
    let attempt = 1;
    let previousSignature: string | null = null;
    const maxAttempts = this.retryPolicy.getBudgets().mode_switch_recoverable;

    while (attempt <= maxAttempts) {
      if (this.isStopped(context)) {
        this.emitStatus(settings, {
          code: 'SUBAGENT_STOPPED',
          category: 'request',
          severity: 'info',
          retryable: false,
          attempt,
          maxAttempts,
          model: args.model,
          flowId: args.flowId,
          subagentId: args.subagentId,
          userMessage: 'Subagent handover stopped by user.',
          action: 'none',
          phase: 'stopped',
          decision: 'abort',
          reason: 'user_stop',
          correlationId: args.correlationId
        });
        this.emitTelemetry(settings, 'SUBAGENT_STOPPED_BY_USER', {
          flowId: args.flowId,
          correlationId: args.correlationId,
          subagentId: args.subagentId,
          code: 'SUBAGENT_STOPPED',
          modeFrom: args.modeFrom,
          modeTo: args.modeTo,
          model: args.model,
          attempt
        });
        return false;
      }

      this.emitTelemetry(settings, 'SUBAGENT_ATTEMPT_START', {
        flowId: args.flowId,
        correlationId: args.correlationId,
        subagentId: args.subagentId,
        code: 'SUBAGENT_MODE_SWITCHED',
        modeFrom: args.modeFrom,
        modeTo: args.modeTo,
        model: args.model,
        attempt
      });

      try {
        await this.deps.performModeSwitch(args.modeTo);
        if ((context.selectedMode || '').toLowerCase() !== args.modeTo.toLowerCase()) {
          throw new Error(`Mode switch did not persist (${args.modeTo})`);
        }
        this.emitStatus(settings, {
          code: 'SUBAGENT_MODE_SWITCHED',
          category: 'subagent',
          severity: 'info',
          retryable: false,
          attempt,
          maxAttempts,
          model: args.model,
          flowId: args.flowId,
          subagentId: args.subagentId,
          userMessage: 'Mode switched to code for subagent run.',
          action: 'none',
          phase: 'mode_switch',
          decision: 'recover',
          reason: 'mode_switch_success',
          correlationId: args.correlationId
        });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const signature = `${error instanceof Error ? error.name : 'Error'}:${message}`;
        const decision = this.retryPolicy.planRetry('mode_switch_recoverable', {
          attemptsUsed: attempt,
          recoverable: this.isRecoverable(error),
          stateChanged: previousSignature !== signature
        });
        previousSignature = signature;

        if (!decision.shouldRetry) {
          const code: SubagentStatusCode =
            decision.reason === 'budget_exhausted' ? 'SUBAGENT_RETRY_EXHAUSTED' : 'SUBAGENT_TERMINAL_FAILED';
          this.emitStatus(settings, {
            code,
            category: 'subagent',
            severity: 'error',
            retryable: false,
            attempt,
            maxAttempts,
            model: args.model,
            flowId: args.flowId,
            subagentId: args.subagentId,
            userMessage: `Subagent mode switch failed: ${message}`,
            action: 'retry',
            phase: 'terminal',
            decision: 'abort',
            reason: decision.reason,
            correlationId: args.correlationId
          });
          this.emitLegacyError(`Subagent mode switch failed: ${message}`, code, 'retry');
          this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
            flowId: args.flowId,
            correlationId: args.correlationId,
            subagentId: args.subagentId,
            code,
            modeFrom: args.modeFrom,
            modeTo: args.modeTo,
            model: args.model,
            attempt
          });
          return false;
        }

        this.emitStatus(settings, {
          code: 'SUBAGENT_RETRY_SCHEDULED',
          category: 'subagent',
          severity: 'warning',
          retryable: true,
          attempt: decision.nextAttempt,
          maxAttempts: decision.maxAttempts,
          nextDelayMs: decision.delayMs,
          model: args.model,
          flowId: args.flowId,
          subagentId: args.subagentId,
          userMessage: `Mode switch retry scheduled (${decision.nextAttempt}/${decision.maxAttempts}).`,
          action: 'retry',
          phase: 'retry',
          decision: 'retry',
          reason: 'mode_switch_recoverable',
          correlationId: args.correlationId
        });
        this.emitTelemetry(settings, 'SUBAGENT_RETRY_SCHEDULED', {
          flowId: args.flowId,
          correlationId: args.correlationId,
          subagentId: args.subagentId,
          code: 'SUBAGENT_RETRY_SCHEDULED',
          modeFrom: args.modeFrom,
          modeTo: args.modeTo,
          model: args.model,
          attempt: decision.nextAttempt,
          nextDelayMs: decision.delayMs
        });
        await this.sleep(decision.delayMs);
        attempt = decision.nextAttempt;
      }
    }

    return false;
  }

  private async runWorkerStartWithRetry(
    context: ChatViewContext,
    settings: SubagentResilienceSettings,
    args: {
      flowId: string;
      subagentId: string;
      correlationId: string;
      model: string;
      modeFrom: string;
      modeTo: string;
      continuationPrompt: string;
    }
  ): Promise<boolean> {
    let attempt = 1;
    let previousSignature: string | null = null;
    const maxAttempts = this.retryPolicy.getBudgets().worker_start_recoverable;

    while (attempt <= maxAttempts) {
      if (this.isStopped(context)) {
        this.emitStatus(settings, {
          code: 'SUBAGENT_STOPPED',
          category: 'request',
          severity: 'info',
          retryable: false,
          attempt,
          maxAttempts,
          model: args.model,
          flowId: args.flowId,
          subagentId: args.subagentId,
          userMessage: 'Subagent worker start stopped by user.',
          action: 'none',
          phase: 'stopped',
          decision: 'abort',
          reason: 'user_stop',
          correlationId: args.correlationId
        });
        this.emitTelemetry(settings, 'SUBAGENT_STOPPED_BY_USER', {
          flowId: args.flowId,
          correlationId: args.correlationId,
          subagentId: args.subagentId,
          code: 'SUBAGENT_STOPPED',
          modeFrom: args.modeFrom,
          modeTo: args.modeTo,
          model: args.model,
          attempt
        });
        return false;
      }

      this.emitStatus(settings, {
        code: 'SUBAGENT_RUNNING',
        category: 'subagent',
        severity: 'info',
        retryable: false,
        attempt,
        maxAttempts,
        model: args.model,
        flowId: args.flowId,
        subagentId: args.subagentId,
        userMessage: 'Starting coder worker...',
        action: 'none',
        phase: 'worker_run',
        decision: 'report',
        reason: 'worker_start',
        correlationId: args.correlationId
      });
      this.emitTelemetry(settings, 'SUBAGENT_ATTEMPT_START', {
        flowId: args.flowId,
        correlationId: args.correlationId,
        subagentId: args.subagentId,
        code: 'SUBAGENT_RUNNING',
        modeFrom: args.modeFrom,
        modeTo: args.modeTo,
        model: args.model,
        attempt
      });

      try {
        await this.deps.sendContinuationMessage(args.continuationPrompt);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const signature = `${error instanceof Error ? error.name : 'Error'}:${message}`;
        const decision = this.retryPolicy.planRetry('worker_start_recoverable', {
          attemptsUsed: attempt,
          recoverable: this.isRecoverable(error),
          stateChanged: previousSignature !== signature
        });
        previousSignature = signature;

        if (!decision.shouldRetry) {
          const code: SubagentStatusCode =
            decision.reason === 'budget_exhausted' ? 'SUBAGENT_RETRY_EXHAUSTED' : 'SUBAGENT_TERMINAL_FAILED';
          this.emitStatus(settings, {
            code,
            category: 'subagent',
            severity: 'error',
            retryable: false,
            attempt,
            maxAttempts,
            model: args.model,
            flowId: args.flowId,
            subagentId: args.subagentId,
            userMessage: `Coder worker failed to start: ${message}`,
            action: 'retry',
            phase: 'terminal',
            decision: 'abort',
            reason: decision.reason,
            correlationId: args.correlationId
          });
          this.emitLegacyError(`Coder worker failed to start: ${message}`, code, 'retry');
          this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
            flowId: args.flowId,
            correlationId: args.correlationId,
            subagentId: args.subagentId,
            code,
            modeFrom: args.modeFrom,
            modeTo: args.modeTo,
            model: args.model,
            attempt
          });
          return false;
        }

        this.emitStatus(settings, {
          code: 'SUBAGENT_RETRY_SCHEDULED',
          category: 'subagent',
          severity: 'warning',
          retryable: true,
          attempt: decision.nextAttempt,
          maxAttempts: decision.maxAttempts,
          nextDelayMs: decision.delayMs,
          model: args.model,
          flowId: args.flowId,
          subagentId: args.subagentId,
          userMessage: `Coder worker retry scheduled (${decision.nextAttempt}/${decision.maxAttempts}).`,
          action: 'retry',
          phase: 'retry',
          decision: 'retry',
          reason: 'worker_start_recoverable',
          correlationId: args.correlationId
        });
        this.emitTelemetry(settings, 'SUBAGENT_RETRY_SCHEDULED', {
          flowId: args.flowId,
          correlationId: args.correlationId,
          subagentId: args.subagentId,
          code: 'SUBAGENT_RETRY_SCHEDULED',
          modeFrom: args.modeFrom,
          modeTo: args.modeTo,
          model: args.model,
          attempt: decision.nextAttempt,
          nextDelayMs: decision.delayMs
        });
        await this.sleep(decision.delayMs);
        attempt = decision.nextAttempt;
      }
    }

    return false;
  }

  private failPreflight(
    settings: SubagentResilienceSettings,
    machine: SubagentRunStateMachine,
    args: {
      flowId: string;
      subagentId: string;
      model: string;
      correlationId: string;
      reason: string;
    }
  ): void {
    this.emitStatus(settings, {
      code: 'SUBAGENT_PREFLIGHT_BLOCKED',
      category: 'subagent',
      severity: 'error',
      retryable: false,
      attempt: 1,
      maxAttempts: 1,
      model: args.model,
      flowId: args.flowId,
      subagentId: args.subagentId,
      userMessage: 'Subagent preflight blocked.',
      action: 'none',
      phase: 'preflight',
      decision: 'abort',
      reason: args.reason,
      correlationId: args.correlationId
    });
    this.emitLegacyError(`Subagent preflight blocked: ${args.reason}`, 'SUBAGENT_PREFLIGHT_BLOCKED', 'none');
    this.emitTelemetry(settings, 'SUBAGENT_TERMINAL_FAILURE', {
      flowId: args.flowId,
      correlationId: args.correlationId,
      subagentId: args.subagentId,
      code: 'SUBAGENT_PREFLIGHT_BLOCKED',
      reason: args.reason,
      attempt: 1
    });
    machine.terminalize('failed', 'preflight_blocked');
  }

  private handleStopped(
    settings: SubagentResilienceSettings,
    machine: SubagentRunStateMachine,
    args: {
      flowId: string;
      subagentId: string;
      model: string;
      correlationId: string;
      phase: SubagentStatusPhase;
    }
  ): void {
    this.emitStatus(settings, {
      code: 'SUBAGENT_STOPPED',
      category: 'request',
      severity: 'info',
      retryable: false,
      attempt: 1,
      maxAttempts: 1,
      model: args.model,
      flowId: args.flowId,
      subagentId: args.subagentId,
      userMessage: 'Subagent run stopped by user.',
      action: 'none',
      phase: args.phase,
      decision: 'abort',
      reason: 'user_stop',
      correlationId: args.correlationId
    });
    this.emitTelemetry(settings, 'SUBAGENT_STOPPED_BY_USER', {
      flowId: args.flowId,
      correlationId: args.correlationId,
      subagentId: args.subagentId,
      code: 'SUBAGENT_STOPPED',
      attempt: 1
    });
    machine.terminalize('stopped', 'user_stop');
  }

  private emitPostHookFailures(
    settings: SubagentResilienceSettings,
    failures: HookFailure[],
    args: {
      flowId: string;
      subagentId: string;
      correlationId: string;
      model: string;
      modeFrom: string;
      modeTo: string;
      attempt: number;
    }
  ): void {
    if (!Array.isArray(failures) || failures.length === 0) return;
    for (const failure of failures) {
      this.emitStatus(settings, {
        code: 'SUBAGENT_POSTHOOK_FAILED',
        category: 'hook',
        severity: 'warning',
        retryable: false,
        attempt: args.attempt,
        maxAttempts: args.attempt,
        model: args.model,
        flowId: args.flowId,
        subagentId: args.subagentId,
        userMessage: `Subagent post-hook failed (${failure.hookName}): ${failure.message}`,
        action: 'none',
        phase: 'merge_summary',
        decision: 'report',
        reason: failure.code,
        correlationId: args.correlationId
      });
      this.emitTelemetry(settings, 'SUBAGENT_HOOK_FAILED', {
        flowId: args.flowId,
        correlationId: args.correlationId,
        subagentId: args.subagentId,
        code: 'SUBAGENT_POSTHOOK_FAILED',
        hookName: failure.hookName,
        modeFrom: args.modeFrom,
        modeTo: args.modeTo,
        model: args.model,
        attempt: args.attempt
      });
    }
  }

  private emitStatus(
    settings: SubagentResilienceSettings,
    payload: {
      code: SubagentStatusCode;
      category: SubagentStatusCategory;
      severity: 'info' | 'warning' | 'error';
      retryable: boolean;
      attempt: number;
      maxAttempts: number;
      nextDelayMs?: number;
      model: string;
      flowId: string | null;
      subagentId: string;
      userMessage: string;
      action: ResilienceStatusAction;
      phase: SubagentStatusPhase;
      decision: SubagentStatusDecision;
      reason: string;
      correlationId: string;
    }
  ): void {
    if (!settings.subagentErrorContractV1) return;
    this.deps.sendMessageToWebview({
      type: 'subagentStatus',
      code: payload.code,
      category: payload.category,
      severity: payload.severity,
      retryable: payload.retryable,
      attempt: payload.attempt,
      maxAttempts: payload.maxAttempts,
      nextDelayMs: payload.nextDelayMs,
      model: payload.model,
      flowId: payload.flowId,
      subagentId: payload.subagentId,
      userMessage: payload.userMessage,
      action: payload.action,
      phase: payload.phase,
      decision: payload.decision,
      reason: payload.reason,
      correlationId: payload.correlationId
    });

    if (payload.code === 'SUBAGENT_START') {
      this.deps.sendMessageToWebview({
        type: 'handoverProgress',
        flowId: payload.flowId,
        status: 'started',
        detail: payload.userMessage,
        timestamp: Date.now()
      } as any);
      return;
    }

    if (payload.code === 'SUBAGENT_SUMMARY_READY') {
      this.deps.sendMessageToWebview({
        type: 'handoverProgress',
        flowId: payload.flowId,
        status: 'completed',
        detail: payload.userMessage,
        timestamp: Date.now()
      } as any);
      return;
    }

    if (
      payload.code === 'SUBAGENT_TERMINAL_FAILED' ||
      payload.code === 'SUBAGENT_STOPPED' ||
      payload.code === 'SUBAGENT_PREFLIGHT_BLOCKED' ||
      payload.code === 'SUBAGENT_PREHOOK_BLOCKED' ||
      payload.code === 'SUBAGENT_PREHOOK_FAILED' ||
      payload.code === 'SUBAGENT_RETRY_EXHAUSTED'
    ) {
      this.deps.sendMessageToWebview({
        type: 'handoverProgress',
        flowId: payload.flowId,
        status: 'aborted',
        detail: payload.userMessage,
        timestamp: Date.now()
      } as any);
    }
  }

  private emitLegacyError(message: string, code: string, action: ResilienceStatusAction): void {
    this.deps.sendMessageToWebview({
      type: 'error',
      message,
      code,
      action
    });
  }

  private emitTelemetry(
    settings: SubagentResilienceSettings,
    eventName:
      | 'SUBAGENT_ATTEMPT_START'
      | 'SUBAGENT_RETRY_SCHEDULED'
      | 'SUBAGENT_RECOVERY_APPLIED'
      | 'SUBAGENT_TERMINAL_FAILURE'
      | 'SUBAGENT_STOPPED_BY_USER'
      | 'SUBAGENT_HOOK_FAILED',
    metadata: Record<string, unknown>
  ): void {
    if (!settings.subagentTelemetryV1) return;
    const level =
      eventName === 'SUBAGENT_TERMINAL_FAILURE'
        ? 'ERROR'
        : eventName === 'SUBAGENT_RETRY_SCHEDULED' || eventName === 'SUBAGENT_HOOK_FAILED'
          ? 'WARN'
          : 'INFO';
    log.event(level, eventName, eventName, metadata);
  }

  private isRecoverable(error: unknown): boolean {
    const message = String((error as any)?.message || error || '').toLowerCase();
    if (!message) return false;
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('temporarily') ||
      message.includes('rate') ||
      message.includes('busy') ||
      message.includes('econnreset')
    );
  }

  private isStopped(context: ChatViewContext): boolean {
    return context.shouldStopStream === true || context.shouldAbortTools === true;
  }

  private async sleep(ms: number): Promise<void> {
    const delay = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (delay <= 0) return;
    if (this.deps.sleep) {
      await this.deps.sleep(delay);
      return;
    }
    await sleepWithAbort(delay);
  }
}
