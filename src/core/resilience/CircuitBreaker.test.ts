import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './CircuitBreaker';

describe('CircuitBreaker', () => {
  it('opens after threshold failures and blocks until cooldown', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1000,
      halfOpenMaxTrials: 1
    });

    breaker.recordFailure(0);
    expect(breaker.getState()).toBe('CLOSED');

    breaker.recordFailure(1);
    expect(breaker.getState()).toBe('OPEN');

    const blocked = breaker.canExecute(500);
    expect(blocked.allowed).toBe(false);
    expect(blocked.state).toBe('OPEN');
  });

  it('moves to HALF_OPEN after cooldown and closes on success', () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 1000,
      halfOpenMaxTrials: 1
    });

    breaker.recordFailure(0);
    const trial = breaker.canExecute(1500);
    expect(trial.allowed).toBe(true);
    expect(trial.state).toBe('HALF_OPEN');

    breaker.recordSuccess();
    expect(breaker.getState()).toBe('CLOSED');
  });
});
