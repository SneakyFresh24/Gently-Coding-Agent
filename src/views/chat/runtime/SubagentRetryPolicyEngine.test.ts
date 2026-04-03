import { describe, expect, it } from 'vitest';
import { SubagentRetryPolicyEngine } from './SubagentRetryPolicyEngine';

describe('SubagentRetryPolicyEngine', () => {
  it('uses deterministic retry budgets', () => {
    const engine = new SubagentRetryPolicyEngine();
    expect(engine.getBudgets()).toEqual({
      mode_switch_recoverable: 2,
      worker_start_recoverable: 2
    });
  });

  it('schedules a single retry with 1000ms delay', () => {
    const engine = new SubagentRetryPolicyEngine();
    const decision = engine.planRetry('mode_switch_recoverable', {
      attemptsUsed: 1,
      recoverable: true,
      stateChanged: true
    });
    expect(decision).toMatchObject({
      shouldRetry: true,
      nextAttempt: 2,
      maxAttempts: 2,
      delayMs: 1000
    });
  });

  it('blocks retry for non-recoverable failures', () => {
    const engine = new SubagentRetryPolicyEngine();
    const decision = engine.planRetry('worker_start_recoverable', {
      attemptsUsed: 1,
      recoverable: false,
      stateChanged: true
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('non_recoverable');
  });

  it('blocks retry when state signature did not change', () => {
    const engine = new SubagentRetryPolicyEngine();
    const decision = engine.planRetry('worker_start_recoverable', {
      attemptsUsed: 1,
      recoverable: true,
      stateChanged: false
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('state_unchanged_blocked');
  });

  it('blocks retry after budget exhaustion', () => {
    const engine = new SubagentRetryPolicyEngine();
    const decision = engine.planRetry('mode_switch_recoverable', {
      attemptsUsed: 2,
      recoverable: true,
      stateChanged: true
    });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('budget_exhausted');
  });
});

