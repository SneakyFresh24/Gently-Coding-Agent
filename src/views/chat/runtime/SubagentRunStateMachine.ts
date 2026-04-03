export type SubagentRunState =
  | 'IDLE'
  | 'PREFLIGHT'
  | 'MODE_SWITCH'
  | 'WORKER_RUN'
  | 'MERGE_SUMMARY'
  | 'TERMINAL';

const ALLOWED_TRANSITIONS: Record<SubagentRunState, SubagentRunState[]> = {
  IDLE: ['PREFLIGHT', 'TERMINAL'],
  PREFLIGHT: ['MODE_SWITCH', 'TERMINAL'],
  MODE_SWITCH: ['WORKER_RUN', 'TERMINAL'],
  WORKER_RUN: ['MERGE_SUMMARY', 'TERMINAL'],
  MERGE_SUMMARY: ['TERMINAL'],
  TERMINAL: []
};

export class SubagentRunTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubagentRunTransitionError';
  }
}

export class SubagentRunStateMachine {
  private state: SubagentRunState = 'IDLE';
  private terminalized = false;
  private terminalOutcome: 'completed' | 'failed' | 'stopped' | null = null;

  getState(): SubagentRunState {
    return this.state;
  }

  getTerminalOutcome(): 'completed' | 'failed' | 'stopped' | null {
    return this.terminalOutcome;
  }

  transition(next: SubagentRunState, reason?: string): void {
    if (this.state === next) return;
    if (this.terminalized) {
      throw new SubagentRunTransitionError(
        `Illegal transition after terminal state: ${this.state} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    if (!ALLOWED_TRANSITIONS[this.state].includes(next)) {
      throw new SubagentRunTransitionError(
        `Illegal transition: ${this.state} -> ${next}${reason ? ` (${reason})` : ''}`
      );
    }
    this.state = next;
  }

  terminalize(outcome: 'completed' | 'failed' | 'stopped', reason?: string): void {
    if (this.terminalized) {
      throw new SubagentRunTransitionError(
        `Subagent run already terminalized as ${this.terminalOutcome}; duplicate outcome ${outcome}${reason ? ` (${reason})` : ''}`
      );
    }
    if (this.state !== 'TERMINAL') {
      this.transition('TERMINAL', reason || `terminal:${outcome}`);
    }
    this.terminalized = true;
    this.terminalOutcome = outcome;
  }

  ensureTerminalized(): void {
    if (!this.terminalized || this.state !== 'TERMINAL') {
      throw new SubagentRunTransitionError(`Subagent run ended without terminal state (state=${this.state})`);
    }
  }
}

