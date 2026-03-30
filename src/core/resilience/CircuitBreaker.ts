export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxTrials: number;
}

export interface CircuitDecision {
  allowed: boolean;
  state: CircuitBreakerState;
  retryAfterMs?: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 300_000,
  halfOpenMaxTrials: 1
};

export class CircuitBreaker {
  private state: CircuitBreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private halfOpenTrials = 0;

  constructor(private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG) { }

  getState(): CircuitBreakerState {
    return this.state;
  }

  canExecute(now = Date.now()): CircuitDecision {
    if (this.state === 'CLOSED') {
      return { allowed: true, state: this.state };
    }

    if (this.state === 'OPEN') {
      const elapsed = now - this.openedAt;
      const retryAfterMs = Math.max(0, this.config.cooldownMs - elapsed);
      if (elapsed < this.config.cooldownMs) {
        return { allowed: false, state: this.state, retryAfterMs };
      }
      this.state = 'HALF_OPEN';
      this.halfOpenTrials = 0;
      return { allowed: true, state: this.state };
    }

    if (this.halfOpenTrials >= this.config.halfOpenMaxTrials) {
      return { allowed: false, state: this.state, retryAfterMs: this.config.cooldownMs };
    }
    this.halfOpenTrials += 1;
    return { allowed: true, state: this.state };
  }

  recordFailure(now = Date.now()): void {
    if (this.state === 'HALF_OPEN') {
      this.trip(now);
      return;
    }

    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) {
      this.trip(now);
    }
  }

  recordSuccess(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = 0;
    this.halfOpenTrials = 0;
  }

  private trip(now: number): void {
    this.state = 'OPEN';
    this.failures = 0;
    this.openedAt = now;
    this.halfOpenTrials = 0;
  }
}
