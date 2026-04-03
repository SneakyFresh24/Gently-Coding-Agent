import { describe, expect, it } from 'vitest';
import {
  computeRecoveryDelayMs,
  getRecoveryPolicy,
  getRecoveryPolicyMatrix
} from './RecoveryPolicyResolver';

describe('RecoveryPolicyResolver', () => {
  it('exposes deterministic policies for required failure paths', () => {
    const matrix = getRecoveryPolicyMatrix();
    expect(matrix.rate_limit_429.telemetryCode).toBe('RATE_LIMIT_RETRY');
    expect(matrix.sequence_repair.maxAttempts).toBe(3);
    expect(matrix.tool_approval_timeout.retryable).toBe(false);
    expect(matrix.stream_contract_violation.retryable).toBe(false);
    expect(matrix.stop_request.terminalAction).toBe('none');
  });

  it('computes retry-after aware delay for 429 policy', () => {
    expect(computeRecoveryDelayMs('rate_limit_429', 1, 2500)).toBe(2500);
    expect(computeRecoveryDelayMs('rate_limit_429', 2, 500)).toBe(2000);
    expect(computeRecoveryDelayMs('rate_limit_429', 2, 12000)).toBe(8000);
  });

  it('uses fixed sequence for tool recoverable retries', () => {
    expect(computeRecoveryDelayMs('tool_recoverable', 1)).toBe(0);
    expect(computeRecoveryDelayMs('tool_recoverable', 2)).toBe(500);
    expect(computeRecoveryDelayMs('tool_recoverable', 3)).toBe(1000);
    expect(computeRecoveryDelayMs('tool_recoverable', 4)).toBe(1000);
  });

  it('returns immutable copies for direct lookups', () => {
    const policy = getRecoveryPolicy('sequence_repair');
    policy.maxAttempts = 999;
    expect(getRecoveryPolicy('sequence_repair').maxAttempts).toBe(3);
  });
});

