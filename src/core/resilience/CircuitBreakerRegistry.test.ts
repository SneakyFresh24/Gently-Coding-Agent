import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreakerRegistry } from './CircuitBreakerRegistry';

const configState = {
  failureThreshold: 5,
  cooldownMs: 300_000,
  halfOpenMaxTrials: 1,
  perToolEnabled: false,
  perToolTargets: ['write_file', 'run_command']
};

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => {
        switch (key) {
          case 'resilience.circuit.failureThreshold':
            return configState.failureThreshold;
          case 'resilience.circuit.cooldownMs':
            return configState.cooldownMs;
          case 'resilience.circuit.halfOpenMaxTrials':
            return configState.halfOpenMaxTrials;
          case 'resilience.circuit.perToolEnabled':
            return configState.perToolEnabled;
          case 'resilience.circuit.perToolTargets':
            return configState.perToolTargets;
          default:
            return fallback;
        }
      }
    })
  }
}));

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    configState.failureThreshold = 1;
    configState.cooldownMs = 1_000;
    configState.halfOpenMaxTrials = 1;
    configState.perToolEnabled = false;
    configState.perToolTargets = ['write_file', 'run_command'];
    vi.restoreAllMocks();
  });

  it('emits opened -> half_open -> closed transitions', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    const registry = new CircuitBreakerRegistry();

    const failure = registry.recordFailure('tool.execute', true, 'write_file');
    expect(failure.transition).toBe('opened');

    const blocked = registry.canExecute('tool.execute', 'write_file');
    expect(blocked.decision.allowed).toBe(false);
    expect(blocked.decision.retryAfterMs).toBeGreaterThan(0);

    nowSpy.mockReturnValue(1_500);
    const halfOpen = registry.canExecute('tool.execute', 'write_file');
    expect(halfOpen.decision.allowed).toBe(true);
    expect(halfOpen.transition).toBe('half_open');

    const success = registry.recordSuccess('tool.execute', 'write_file');
    expect(success.transition).toBe('closed');
  });

  it('isolates per-tool breakers when enabled', () => {
    configState.perToolEnabled = true;
    configState.perToolTargets = ['write_file', 'run_command'];
    const registry = new CircuitBreakerRegistry();

    registry.recordFailure('tool.execute', true, 'write_file');

    const writeGate = registry.canExecute('tool.execute', 'write_file');
    const runGate = registry.canExecute('tool.execute', 'run_command');

    expect(writeGate.key).toBe('tool.execute:write_file');
    expect(runGate.key).toBe('tool.execute:run_command');
    expect(writeGate.decision.allowed).toBe(false);
    expect(runGate.decision.allowed).toBe(true);
  });
});
