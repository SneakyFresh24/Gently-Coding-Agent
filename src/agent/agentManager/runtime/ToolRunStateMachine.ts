export type ToolRunPhase =
  | 'INIT'
  | 'PRE_HOOK'
  | 'VALIDATE'
  | 'CIRCUIT'
  | 'APPROVAL'
  | 'EXECUTE'
  | 'POST_HOOK'
  | 'TERMINAL';

export type ToolTerminalOutcome = 'completed' | 'failed' | 'stopped';

const ALLOWED_TRANSITIONS: Record<ToolRunPhase, ToolRunPhase[]> = {
  INIT: ['PRE_HOOK', 'TERMINAL'],
  PRE_HOOK: ['VALIDATE', 'TERMINAL'],
  VALIDATE: ['CIRCUIT', 'TERMINAL'],
  CIRCUIT: ['APPROVAL', 'TERMINAL'],
  APPROVAL: ['EXECUTE', 'TERMINAL'],
  EXECUTE: ['POST_HOOK', 'TERMINAL'],
  POST_HOOK: ['TERMINAL'],
  TERMINAL: []
};

export class ToolRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRunTransitionError';
  }
}

export class ToolRunStateMachine {
  private phase: ToolRunPhase = 'INIT';
  private terminalized = false;
  private activeRetry = false;
  private terminalOutcome: ToolTerminalOutcome | null = null;

  getPhase(): ToolRunPhase {
    return this.phase;
  }

  getTerminalOutcome(): ToolTerminalOutcome | null {
    return this.terminalOutcome;
  }

  transition(next: ToolRunPhase, reason?: string): void {
    if (this.phase === next) return;
    if (this.terminalized) {
      throw new ToolRunTransitionError(
        `Illegal transition after terminal: ${this.phase} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    if (!ALLOWED_TRANSITIONS[this.phase].includes(next)) {
      throw new ToolRunTransitionError(
        `Illegal transition: ${this.phase} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    this.phase = next;
  }

  beginRetry(): void {
    if (this.activeRetry) {
      throw new ToolRunTransitionError('Parallel retry loops are forbidden');
    }
    this.activeRetry = true;
  }

  endRetry(): void {
    this.activeRetry = false;
  }

  terminalize(outcome: ToolTerminalOutcome, reason?: string): void {
    if (this.terminalized) {
      throw new ToolRunTransitionError(
        `Duplicate terminalization: existing=${this.terminalOutcome}, incoming=${outcome}${reason ? ` (${reason})` : ''}`
      );
    }
    if (this.phase !== 'TERMINAL') {
      this.transition('TERMINAL', reason || `terminal:${outcome}`);
    }
    this.terminalized = true;
    this.terminalOutcome = outcome;
    this.activeRetry = false;
  }

  ensureTerminalized(): void {
    if (!this.terminalized || this.phase !== 'TERMINAL') {
      throw new ToolRunTransitionError(`Tool run ended without terminal state (phase=${this.phase})`);
    }
  }
}

