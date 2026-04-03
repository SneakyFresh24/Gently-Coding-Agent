import {
  computeRecoveryDelayMs,
  getRecoveryPolicy
} from '../../../core/resilience/RecoveryPolicyResolver';

export interface ToolRetryPolicyConfig {
  recoverableRetries: number;
  delaysMs: number[];
}

export interface ToolRetryDecision {
  shouldRetry: boolean;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: 'retry_allowed' | 'budget_exhausted' | 'non_recoverable' | 'state_unchanged';
}

const DEFAULT_POLICY: ToolRetryPolicyConfig = {
  recoverableRetries: Math.max(0, getRecoveryPolicy('tool_recoverable').maxAttempts - 1),
  delaysMs: getRecoveryPolicy('tool_recoverable').delaySequenceMs || [500, 1000]
};

export class ToolRetryPolicyEngine {
  constructor(private readonly policy: ToolRetryPolicyConfig = DEFAULT_POLICY) {}

  getPolicy(): ToolRetryPolicyConfig {
    return {
      recoverableRetries: this.policy.recoverableRetries,
      delaysMs: [...this.policy.delaysMs]
    };
  }

  decideRecoverableRetry(input: {
    attemptsUsed: number;
    recoverable: boolean;
    stateChanged?: boolean;
  }): ToolRetryDecision {
    const maxAttempts = 1 + this.policy.recoverableRetries;
    const nextAttempt = Math.floor(Math.max(0, input.attemptsUsed)) + 1;
    if (!input.recoverable) {
      return { shouldRetry: false, nextAttempt, maxAttempts, delayMs: 0, reason: 'non_recoverable' };
    }
    if (input.stateChanged === false) {
      return { shouldRetry: false, nextAttempt, maxAttempts, delayMs: 0, reason: 'state_unchanged' };
    }
    if (nextAttempt > maxAttempts) {
      return { shouldRetry: false, nextAttempt, maxAttempts, delayMs: 0, reason: 'budget_exhausted' };
    }
    return {
      shouldRetry: true,
      nextAttempt,
      maxAttempts,
      delayMs: this.delayForAttempt(nextAttempt),
      reason: 'retry_allowed'
    };
  }

  private delayForAttempt(attempt: number): number {
    if (attempt <= 1) return 0;
    if (this.policy.delaysMs.length > 0) {
      const index = Math.min(this.policy.delaysMs.length - 1, Math.max(0, attempt - 2));
      const delay = this.policy.delaysMs[index];
      if (Number.isFinite(delay) && delay >= 0) return delay;
    }
    return computeRecoveryDelayMs('tool_recoverable', attempt);
  }
}
