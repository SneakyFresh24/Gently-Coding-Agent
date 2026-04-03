import { describe, expect, it } from 'vitest';
import { RetryPolicyEngine } from './RetryPolicyEngine';

describe('RetryPolicyEngine', () => {
  it('uses deterministic default budgets', () => {
    const engine = new RetryPolicyEngine();
    expect(engine.getBudgets()).toEqual({
      context: 4,
      sequence: 3,
      empty: 2,
      rate_limit: 2
    });
  });

  it('applies sequence backoff schedule 2s/4s/8s', () => {
    const engine = new RetryPolicyEngine();
    expect(engine.planRetry('sequence', { attemptsUsed: 0, stateChanged: true }).delayMs).toBe(2000);
    expect(engine.planRetry('sequence', { attemptsUsed: 1, stateChanged: true }).delayMs).toBe(4000);
    expect(engine.planRetry('sequence', { attemptsUsed: 2, stateChanged: true }).delayMs).toBe(8000);
  });

  it('applies empty-response backoff schedule 1s/2s', () => {
    const engine = new RetryPolicyEngine();
    expect(engine.planRetry('empty', { attemptsUsed: 0, stateChanged: true }).delayMs).toBe(1000);
    expect(engine.planRetry('empty', { attemptsUsed: 1, stateChanged: true }).delayMs).toBe(2000);
  });

  it('uses max(retry-after, exp-backoff) for rate-limit retries with cap', () => {
    const engine = new RetryPolicyEngine();
    expect(engine.planRetry('rate_limit', { attemptsUsed: 0, retryAfterMs: 2500 }).delayMs).toBe(2500);
    expect(engine.planRetry('rate_limit', { attemptsUsed: 1, retryAfterMs: 500 }).delayMs).toBe(2000);
    expect(engine.planRetry('rate_limit', { attemptsUsed: 1, retryAfterMs: 12000 }).delayMs).toBe(8000);
  });

  it('blocks retries without state change for context/sequence/empty', () => {
    const engine = new RetryPolicyEngine();
    expect(engine.planRetry('context', { attemptsUsed: 0, stateChanged: false })).toMatchObject({
      shouldRetry: false,
      reason: 'state_unchanged_blocked'
    });
    expect(engine.planRetry('sequence', { attemptsUsed: 0, stateChanged: false })).toMatchObject({
      shouldRetry: false,
      reason: 'state_unchanged_blocked'
    });
    expect(engine.planRetry('empty', { attemptsUsed: 0, stateChanged: false })).toMatchObject({
      shouldRetry: false,
      reason: 'state_unchanged_blocked'
    });
  });

  it('does not require state change for rate-limit retries', () => {
    const engine = new RetryPolicyEngine();
    const decision = engine.planRetry('rate_limit', { attemptsUsed: 0, stateChanged: false });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.reason).toBe('retry_allowed');
  });

  it('stops retries when budget is exhausted', () => {
    const engine = new RetryPolicyEngine();
    const decision = engine.planRetry('empty', { attemptsUsed: 2, stateChanged: true });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toBe('budget_exhausted');
  });
});
