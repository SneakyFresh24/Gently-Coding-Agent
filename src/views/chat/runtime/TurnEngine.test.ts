import { describe, expect, it } from 'vitest';
import { TurnEngine, TurnEngineTransitionError } from './TurnEngine';

describe('TurnEngine', () => {
  it('allows valid transitions and terminalization', () => {
    const engine = new TurnEngine();
    engine.transition('PREFLIGHT', 'start');
    engine.transition('STREAMING', 'stream');
    engine.transition('TOOL_EXEC', 'tool');
    engine.transition('STREAMING', 'resume_stream');
    engine.terminalize('completed', 'done');

    expect(engine.getState()).toBe('TERMINAL');
    expect(engine.getTerminalOutcome()).toBe('completed');
    expect(() => engine.ensureTerminalized()).not.toThrow();
  });

  it('rejects illegal transitions', () => {
    const engine = new TurnEngine();
    expect(() => engine.transition('TOOL_EXEC', 'illegal')).toThrow(TurnEngineTransitionError);
  });

  it('rejects parallel recovery categories', () => {
    const engine = new TurnEngine();
    engine.transition('PREFLIGHT', 'start');
    engine.beginRecovery('context', 'ctx');
    expect(() => engine.beginRecovery('sequence', 'seq')).toThrow(TurnEngineTransitionError);
  });

  it('rejects duplicate terminalization', () => {
    const engine = new TurnEngine();
    engine.transition('PREFLIGHT', 'start');
    engine.terminalize('failed', 'fail');
    expect(() => engine.terminalize('completed', 'duplicate')).toThrow(TurnEngineTransitionError);
  });

  it('fails ensureTerminalized when no terminal outcome exists', () => {
    const engine = new TurnEngine();
    engine.transition('PREFLIGHT', 'start');
    expect(() => engine.ensureTerminalized()).toThrow(TurnEngineTransitionError);
  });
});

