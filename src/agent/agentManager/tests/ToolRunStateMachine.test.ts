import { describe, expect, it } from 'vitest';
import { ToolRunStateMachine, ToolRunTransitionError } from '../runtime/ToolRunStateMachine';

describe('ToolRunStateMachine', () => {
  it('allows valid phase transitions and terminalization', () => {
    const machine = new ToolRunStateMachine();
    machine.transition('PRE_HOOK');
    machine.transition('VALIDATE');
    machine.transition('CIRCUIT');
    machine.transition('APPROVAL');
    machine.transition('EXECUTE');
    machine.transition('POST_HOOK');
    machine.terminalize('completed');
    expect(machine.getPhase()).toBe('TERMINAL');
    expect(machine.getTerminalOutcome()).toBe('completed');
    expect(() => machine.ensureTerminalized()).not.toThrow();
  });

  it('blocks illegal transition', () => {
    const machine = new ToolRunStateMachine();
    expect(() => machine.transition('EXECUTE')).toThrow(ToolRunTransitionError);
  });

  it('blocks parallel retries', () => {
    const machine = new ToolRunStateMachine();
    machine.beginRetry();
    expect(() => machine.beginRetry()).toThrow(ToolRunTransitionError);
    machine.endRetry();
  });

  it('requires exactly one terminalization', () => {
    const machine = new ToolRunStateMachine();
    machine.terminalize('failed');
    expect(() => machine.terminalize('completed')).toThrow(ToolRunTransitionError);
  });
});

