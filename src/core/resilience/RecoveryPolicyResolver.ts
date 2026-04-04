export type RecoveryPolicyKey =
  | 'context_recovery'
  | 'sequence_repair'
  | 'empty_response'
  | 'rate_limit_429'
  | 'tool_recoverable'
  | 'stream_contract_violation'
  | 'stop_request'
  | 'subagent_mode_switch'
  | 'subagent_worker_start';

export type RecoveryDelayStrategy =
  | 'none'
  | 'fixed'
  | 'exponential'
  | 'retry_after_or_exponential';

export type RecoveryTerminalAction = 'abort' | 'report' | 'none';

export interface RecoveryPolicy {
  key: RecoveryPolicyKey;
  retryable: boolean;
  maxAttempts: number;
  delayStrategy: RecoveryDelayStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  fixedDelayMs?: number;
  delaySequenceMs?: number[];
  terminalAction: RecoveryTerminalAction;
  userFacingMessage: string;
  telemetryCode: string;
}

const POLICY_MATRIX: Record<RecoveryPolicyKey, RecoveryPolicy> = {
  context_recovery: {
    key: 'context_recovery',
    retryable: true,
    maxAttempts: 4,
    delayStrategy: 'none',
    baseDelayMs: 0,
    maxDelayMs: 0,
    terminalAction: 'abort',
    userFacingMessage: 'Automatic context recovery was exhausted.',
    telemetryCode: 'CTX_RECOVERY_EXHAUSTED'
  },
  sequence_repair: {
    key: 'sequence_repair',
    retryable: true,
    maxAttempts: 3,
    delayStrategy: 'exponential',
    baseDelayMs: 2000,
    maxDelayMs: 8000,
    terminalAction: 'abort',
    userFacingMessage: 'Tool-call sequence repair failed.',
    telemetryCode: 'SEQUENCE_REPAIR_RETRY'
  },
  empty_response: {
    key: 'empty_response',
    retryable: true,
    maxAttempts: 2,
    delayStrategy: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 2000,
    terminalAction: 'abort',
    userFacingMessage: 'No assistant response received.',
    telemetryCode: 'EMPTY_RESPONSE_DETECTED'
  },
  rate_limit_429: {
    key: 'rate_limit_429',
    retryable: true,
    maxAttempts: 2,
    delayStrategy: 'retry_after_or_exponential',
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    terminalAction: 'abort',
    userFacingMessage: 'Provider rate-limited the request.',
    telemetryCode: 'RATE_LIMIT_RETRY'
  },
  tool_recoverable: {
    key: 'tool_recoverable',
    retryable: true,
    maxAttempts: 3,
    delayStrategy: 'fixed',
    baseDelayMs: 0,
    maxDelayMs: 1000,
    delaySequenceMs: [500, 1000],
    terminalAction: 'abort',
    userFacingMessage: 'Tool execution failed and is being retried.',
    telemetryCode: 'TOOL_RETRY_SCHEDULED'
  },
  stream_contract_violation: {
    key: 'stream_contract_violation',
    retryable: false,
    maxAttempts: 1,
    delayStrategy: 'none',
    baseDelayMs: 0,
    maxDelayMs: 0,
    terminalAction: 'report',
    userFacingMessage: 'Streaming contract was violated.',
    telemetryCode: 'STREAM_CONTRACT_MISSING_STOP'
  },
  stop_request: {
    key: 'stop_request',
    retryable: false,
    maxAttempts: 1,
    delayStrategy: 'none',
    baseDelayMs: 0,
    maxDelayMs: 0,
    terminalAction: 'none',
    userFacingMessage: 'Request stopped by user.',
    telemetryCode: 'REQUEST_STOPPED'
  },
  subagent_mode_switch: {
    key: 'subagent_mode_switch',
    retryable: true,
    maxAttempts: 2,
    delayStrategy: 'fixed',
    fixedDelayMs: 1000,
    baseDelayMs: 1000,
    maxDelayMs: 1000,
    terminalAction: 'abort',
    userFacingMessage: 'Subagent mode switch failed.',
    telemetryCode: 'SUBAGENT_RETRY_SCHEDULED'
  },
  subagent_worker_start: {
    key: 'subagent_worker_start',
    retryable: true,
    maxAttempts: 2,
    delayStrategy: 'fixed',
    fixedDelayMs: 1000,
    baseDelayMs: 1000,
    maxDelayMs: 1000,
    terminalAction: 'abort',
    userFacingMessage: 'Subagent worker failed to start.',
    telemetryCode: 'SUBAGENT_RETRY_SCHEDULED'
  }
};

export function getRecoveryPolicy(key: RecoveryPolicyKey): RecoveryPolicy {
  return { ...POLICY_MATRIX[key] };
}

export function getRecoveryPolicyMatrix(): Record<RecoveryPolicyKey, RecoveryPolicy> {
  const result = {} as Record<RecoveryPolicyKey, RecoveryPolicy>;
  const keys = Object.keys(POLICY_MATRIX) as RecoveryPolicyKey[];
  for (const key of keys) {
    result[key] = getRecoveryPolicy(key);
  }
  return result;
}

export function computeRecoveryDelayMs(
  key: RecoveryPolicyKey,
  attempt: number,
  retryAfterMs?: number
): number {
  const policy = POLICY_MATRIX[key];
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;

  if (policy.delayStrategy === 'none') return 0;

  if (policy.delayStrategy === 'fixed') {
    if (Array.isArray(policy.delaySequenceMs) && policy.delaySequenceMs.length > 0) {
      const idx = Math.min(policy.delaySequenceMs.length - 1, Math.max(0, safeAttempt - 2));
      return safeAttempt <= 1 ? 0 : Math.max(0, Math.floor(policy.delaySequenceMs[idx]));
    }
    return Math.max(0, Math.floor(policy.fixedDelayMs || policy.baseDelayMs));
  }

  const exponential = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * (2 ** Math.max(0, safeAttempt - 1))
  );

  if (policy.delayStrategy === 'retry_after_or_exponential') {
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(policy.maxDelayMs, Math.max(exponential, Math.floor(retryAfterMs)));
    }
  }

  return Math.max(0, Math.floor(exponential));
}
