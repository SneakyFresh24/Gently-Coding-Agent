import { describe, expect, it } from 'vitest';
import {
  buildR4SuiteReport,
  countReplayMismatches,
  createDeterministicFaultPlan,
  normalizeReplaySnapshot
} from './R4SoakHarness';

describe('R4SoakHarness', () => {
  it('builds deterministic fault plans for a given seed', () => {
    const catalog = ['a', 'b', 'c'];
    const first = createDeterministicFaultPlan(12, catalog, 1337);
    const second = createDeterministicFaultPlan(12, catalog, 1337);
    const third = createDeterministicFaultPlan(12, catalog, 7331);

    expect(first).toEqual(second);
    expect(first).not.toEqual(third);
    expect(first).toHaveLength(12);
  });

  it('normalizes volatile fields in replay snapshots', () => {
    const normalized = normalizeReplaySnapshot({
      terminalCode: 'ERR',
      timestamp: 12345,
      flowId: 'flow-a',
      nested: {
        correlationId: 'corr',
        stuck: false,
        durationMs: 200
      }
    });

    expect(normalized).toEqual({
      nested: {
        stuck: false
      },
      terminalCode: 'ERR'
    });
  });

  it('counts replay mismatches after normalization', () => {
    const first = [
      { terminalCode: 'A', flowId: 'f1', timestamp: 1 },
      { terminalCode: 'B', action: 'retry', timestamp: 2 }
    ];
    const second = [
      { terminalCode: 'A', flowId: 'f2', timestamp: 99 },
      { terminalCode: 'C', action: 'retry', timestamp: 2 }
    ];

    expect(countReplayMismatches(first, second)).toBe(1);
  });

  it('computes pass/fail based on R4 thresholds', () => {
    const passing = buildR4SuiteReport({
      suite: 'chat',
      totalFlows: 1000,
      silentAborts: 0,
      stuckStates: 0,
      terminalFailures: 100,
      terminalFailuresWithCodeAndAction: 100,
      retryableRecoveryTotal: 200,
      retryableRecoverySucceeded: 198,
      replayMismatchCount: 0
    });
    expect(passing.pass).toBe(true);

    const failing = buildR4SuiteReport({
      suite: 'chat',
      totalFlows: 1000,
      silentAborts: 0,
      stuckStates: 0,
      terminalFailures: 100,
      terminalFailuresWithCodeAndAction: 99,
      retryableRecoveryTotal: 200,
      retryableRecoverySucceeded: 198,
      replayMismatchCount: 0
    });
    expect(failing.pass).toBe(false);
  });
});
