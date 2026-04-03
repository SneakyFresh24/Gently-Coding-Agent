export type TurnState = 'INIT' | 'PREFLIGHT' | 'STREAMING' | 'TOOL_EXEC' | 'RECOVERY' | 'TERMINAL';
export type RecoveryCategory = 'context' | 'sequence' | 'empty' | 'rate_limit';

const ALLOWED_TRANSITIONS: Record<TurnState, TurnState[]> = {
  INIT: ['PREFLIGHT', 'TERMINAL'],
  PREFLIGHT: ['STREAMING', 'RECOVERY', 'TERMINAL'],
  STREAMING: ['TOOL_EXEC', 'RECOVERY', 'TERMINAL'],
  TOOL_EXEC: ['STREAMING', 'RECOVERY', 'TERMINAL'],
  RECOVERY: ['PREFLIGHT', 'STREAMING', 'TERMINAL'],
  TERMINAL: []
};

export class TurnEngineTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TurnEngineTransitionError';
  }
}

export class TurnEngine {
  private state: TurnState = 'INIT';
  private terminalized = false;
  private activeRecovery: RecoveryCategory | null = null;
  private terminalOutcome: 'completed' | 'failed' | 'stopped' | null = null;

  getState(): TurnState {
    return this.state;
  }

  getTerminalOutcome(): 'completed' | 'failed' | 'stopped' | null {
    return this.terminalOutcome;
  }

  transition(next: TurnState, reason?: string): void {
    if (this.state === next) return;
    if (this.terminalized) {
      throw new TurnEngineTransitionError(
        `Illegal transition after terminal state: ${this.state} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      throw new TurnEngineTransitionError(
        `Illegal transition: ${this.state} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    this.state = next;
  }

  beginRecovery(category: RecoveryCategory, reason?: string): void {
    if (this.activeRecovery && this.activeRecovery !== category) {
      throw new TurnEngineTransitionError(
        `Parallel recovery paths are forbidden: active=${this.activeRecovery}, requested=${category}`
      );
    }
    this.activeRecovery = category;
    this.transition('RECOVERY', reason || `recovery:${category}`);
  }

  endRecovery(next: 'PREFLIGHT' | 'STREAMING' = 'STREAMING', reason?: string): void {
    this.activeRecovery = null;
    this.transition(next, reason || 'recovery_end');
  }

  terminalize(outcome: 'completed' | 'failed' | 'stopped', reason?: string): void {
    if (this.terminalized) {
      throw new TurnEngineTransitionError(
        `Turn already terminalized as ${this.terminalOutcome}; duplicate outcome ${outcome}${reason ? ` (${reason})` : ''}`
      );
    }
    if (this.state !== 'TERMINAL') {
      this.transition('TERMINAL', reason || `terminal:${outcome}`);
    }
    this.terminalized = true;
    this.terminalOutcome = outcome;
    this.activeRecovery = null;
  }

  ensureTerminalized(): void {
    if (!this.terminalized || this.state !== 'TERMINAL') {
      throw new TurnEngineTransitionError(`Turn ended without terminal state (state=${this.state})`);
    }
  }
}

