import {
  computeRecoveryDelayMs,
  getRecoveryPolicy
} from '../../../core/resilience/RecoveryPolicyResolver';

export type RetryCategory = 'context' | 'sequence' | 'empty' | 'rate_limit';

export interface RetryBudgets {
  context: number;
  sequence: number;
  empty: number;
  rate_limit: number;
}

export interface RetryPlanInput {
  attemptsUsed: number;
  stateChanged?: boolean;
  retryAfterMs?: number;
}

export interface RetryPlanDecision {
  shouldRetry: boolean;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  reason:
    | 'retry_allowed'
    | 'budget_exhausted'
    | 'state_unchanged_blocked'
    | 'invalid_attempt_count';
}

const DEFAULT_BUDGETS: RetryBudgets = {
  context: getRecoveryPolicy('context_recovery').maxAttempts,
  sequence: getRecoveryPolicy('sequence_repair').maxAttempts,
  empty: getRecoveryPolicy('empty_response').maxAttempts,
  rate_limit: getRecoveryPolicy('rate_limit_429').maxAttempts
};

export class RetryPolicyEngine {
  constructor(private readonly budgets: RetryBudgets = DEFAULT_BUDGETS) {}

  getBudgets(): RetryBudgets {
    return { ...this.budgets };
  }

  planRetry(category: RetryCategory, input: RetryPlanInput): RetryPlanDecision {
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

    if (nextAttempt > maxAttempts) {
      return {
        shouldRetry: false,
        nextAttempt,
        maxAttempts,
        delayMs: 0,
        reason: 'budget_exhausted'
      };
    }

    const requiresStateChange = category === 'context' || category === 'sequence' || category === 'empty';
    if (requiresStateChange && input.stateChanged === false) {
      return {
        shouldRetry: false,
        nextAttempt,
        maxAttempts,
        delayMs: 0,
        reason: 'state_unchanged_blocked'
      };
    }

    return {
      shouldRetry: true,
      nextAttempt,
      maxAttempts,
      delayMs: this.computeDelayMs(category, nextAttempt, input.retryAfterMs),
      reason: 'retry_allowed'
    };
  }

  private computeDelayMs(category: RetryCategory, attempt: number, retryAfterMs?: number): number {
    if (category === 'context') {
      return computeRecoveryDelayMs('context_recovery', attempt, retryAfterMs);
    }
    if (category === 'sequence') {
      return computeRecoveryDelayMs('sequence_repair', attempt, retryAfterMs);
    }
    if (category === 'empty') {
      return computeRecoveryDelayMs('empty_response', attempt, retryAfterMs);
    }
    return computeRecoveryDelayMs('rate_limit_429', attempt, retryAfterMs);
  }
}
