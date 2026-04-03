import {
  computeRecoveryDelayMs,
  getRecoveryPolicy
} from '../../../core/resilience/RecoveryPolicyResolver';

export type SubagentRetryCategory = 'mode_switch_recoverable' | 'worker_start_recoverable';

export interface SubagentRetryBudgets {
  mode_switch_recoverable: number;
  worker_start_recoverable: number;
}

export interface SubagentRetryPlanInput {
  attemptsUsed: number;
  recoverable: boolean;
  stateChanged?: boolean;
}

export interface SubagentRetryPlanDecision {
  shouldRetry: boolean;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  reason:
    | 'retry_allowed'
    | 'budget_exhausted'
    | 'non_recoverable'
    | 'state_unchanged_blocked'
    | 'invalid_attempt_count';
}

const DEFAULT_BUDGETS: SubagentRetryBudgets = {
  mode_switch_recoverable: getRecoveryPolicy('subagent_mode_switch').maxAttempts,
  worker_start_recoverable: getRecoveryPolicy('subagent_worker_start').maxAttempts
};

export class SubagentRetryPolicyEngine {
  constructor(private readonly budgets: SubagentRetryBudgets = DEFAULT_BUDGETS) {}

  getBudgets(): SubagentRetryBudgets {
    return { ...this.budgets };
  }

  planRetry(category: SubagentRetryCategory, input: SubagentRetryPlanInput): SubagentRetryPlanDecision {
    if (!Number.isFinite(input.attemptsUsed) || input.attemptsUsed < 0) {
      return {
        shouldRetry: false,
        nextAttempt: 0,
        maxAttempts: this.budgets[category],
        delayMs: 0,
        reason: 'invalid_attempt_count'
      };
    }

    const maxAttempts = this.budgets[category];
    const nextAttempt = Math.floor(input.attemptsUsed) + 1;

    if (!input.recoverable) {
      return {
        shouldRetry: false,
        nextAttempt,
        maxAttempts,
        delayMs: 0,
        reason: 'non_recoverable'
      };
    }

    if (input.stateChanged === false) {
      return {
        shouldRetry: false,
        nextAttempt,
        maxAttempts,
        delayMs: 0,
        reason: 'state_unchanged_blocked'
      };
    }

    if (nextAttempt > maxAttempts) {
      return {
        shouldRetry: false,
        nextAttempt,
        maxAttempts,
        delayMs: 0,
        reason: 'budget_exhausted'
      };
    }

    return {
      shouldRetry: true,
      nextAttempt,
      maxAttempts,
      delayMs: this.computeDelayMs(category, nextAttempt),
      reason: 'retry_allowed'
    };
  }

  private computeDelayMs(category: SubagentRetryCategory, attempt: number): number {
    if (attempt <= 1) return 0;
    return category === 'worker_start_recoverable'
      ? computeRecoveryDelayMs('subagent_worker_start', attempt)
      : computeRecoveryDelayMs('subagent_mode_switch', attempt);
  }
}
