import { describe, expect, it } from 'vitest';
import { ToolRetryPolicyEngine } from '../runtime/ToolRetryPolicyEngine';

describe('ToolRetryPolicyEngine', () => {
  it('uses default retry budget and delays', () => {
    const engine = new ToolRetryPolicyEngine();
    expect(engine.getPolicy()).toEqual({
      recoverableRetries: 2,
      delaysMs: [500, 1000]
    });
  });

  it('applies deterministic delays for retry attempts', () => {
    const engine = new ToolRetryPolicyEngine();
    expect(engine.decideRecoverableRetry({ attemptsUsed: 0, recoverable: true })).toMatchObject({
      shouldRetry: true,
      nextAttempt: 1,
      delayMs: 0
    });
    expect(engine.decideRecoverableRetry({ attemptsUsed: 1, recoverable: true })).toMatchObject({
      shouldRetry: true,
      nextAttempt: 2,
      delayMs: 500
    });
    expect(engine.decideRecoverableRetry({ attemptsUsed: 2, recoverable: true })).toMatchObject({
      shouldRetry: true,
      nextAttempt: 3,
      delayMs: 1000
    });
  });

  it('stops after budget exhaustion', () => {
    const engine = new ToolRetryPolicyEngine();
    const exhausted = engine.decideRecoverableRetry({ attemptsUsed: 3, recoverable: true });
    expect(exhausted.shouldRetry).toBe(false);
    expect(exhausted.reason).toBe('budget_exhausted');
  });

  it('never retries non-recoverable failures', () => {
    const engine = new ToolRetryPolicyEngine();
    const decision = engine.decideRecoverableRetry({ attemptsUsed: 0, recoverable: false });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('non_recoverable');
  });
});

