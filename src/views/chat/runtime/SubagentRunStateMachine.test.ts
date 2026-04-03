import { describe, expect, it } from 'vitest';
import { SubagentRunStateMachine, SubagentRunTransitionError } from './SubagentRunStateMachine';

describe('SubagentRunStateMachine', () => {
  it('allows valid transitions and terminalization', () => {
    const machine = new SubagentRunStateMachine();
    machine.transition('PREFLIGHT', 'start');
    machine.transition('MODE_SWITCH', 'mode_switch');
    machine.transition('WORKER_RUN', 'worker_start');
    machine.transition('MERGE_SUMMARY', 'summary');
    machine.terminalize('completed', 'done');

    expect(machine.getState()).toBe('TERMINAL');
    expect(machine.getTerminalOutcome()).toBe('completed');
    expect(() => machine.ensureTerminalized()).not.toThrow();
  });

  it('rejects illegal transitions', () => {
    const machine = new SubagentRunStateMachine();
    expect(() => machine.transition('WORKER_RUN', 'illegal')).toThrow(SubagentRunTransitionError);
  });

  it('rejects duplicate terminalization', () => {
    const machine = new SubagentRunStateMachine();
    machine.transition('PREFLIGHT', 'start');
    machine.terminalize('failed', 'first');
    expect(() => machine.terminalize('completed', 'duplicate')).toThrow(SubagentRunTransitionError);
  });

  it('fails ensureTerminalized when terminal state was not reached', () => {
    const machine = new SubagentRunStateMachine();
    machine.transition('PREFLIGHT', 'start');
    expect(() => machine.ensureTerminalized()).toThrow(SubagentRunTransitionError);
  });
});

