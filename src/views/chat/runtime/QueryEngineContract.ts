export type QueryResultCode =
  | 'RESULT_SUCCESS'
  | 'REQUEST_STOPPED'
  | 'GUARDRAIL_PRIVACY_BLOCK'
  | 'STREAM_CONTRACT_MISSING_STOP'
  | 'CTX_BUDGET_UNSAFE'
  | 'CTX_RECOVERY_EXHAUSTED'
  | 'SEQUENCE_REPAIR_EXHAUSTED'
  | 'EMPTY_RESPONSE_RETRY_EXHAUSTED'
  | 'RATE_LIMIT_RETRY_EXHAUSTED'
  | 'MAX_TURNS_EXCEEDED'
  | 'MAX_BUDGET_EXCEEDED'
  | 'MAX_STRUCTURED_OUTPUT_RETRIES_EXCEEDED'
  | 'UNEXPECTED_FAILURE';

export type QueryResultCategory =
  | 'success'
  | 'request'
  | 'guardrail'
  | 'context'
  | 'sequence'
  | 'empty_response'
  | 'rate_limit'
  | 'runtime';

export interface QueryRuntimeResult {
  code: QueryResultCode;
  category: QueryResultCategory;
  retryable: boolean;
  attempt: number;
  maxAttempts: number;
  stopReason: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
  };
  cost: number | null;
  permissionDenials: string[];
  message?: string;
}

export type QueryRuntimeEvent =
  | {
      type: 'system_init';
      model: string;
      flowId: string;
      maxTurns: number;
      maxBudgetUsd: number | null;
      maxStructuredOutputRetries: number;
    }
  | {
      type: 'turn_transition';
      flowId: string;
      from: string;
      to: string;
      reason: string;
    }
  | {
      type: 'query_attempt';
      flowId: string;
      attempt: number;
      maxAttempts: number;
    }
  | {
      type: 'status';
      flowId: string;
      model: string;
      code: string;
      category: string;
      severity: 'info' | 'warning' | 'error';
      retryable: boolean;
      attempt: number;
      maxAttempts: number;
      nextDelayMs?: number;
      userMessage: string;
      action: string;
      phase: 'preflight' | 'runtime' | 'retry' | 'terminal' | 'stopped';
      decision: 'retry' | 'recover' | 'abort' | 'ignore' | 'report';
      reason: string;
      correlationId: string;
    }
  | {
      type: 'tool_summary';
      flowId: string;
      toolCalls: number;
      incompleteToolCalls: number;
    }
  | {
      type: 'compaction_boundary';
      flowId: string;
      reason: 'budget' | 'overflow_rescue';
      droppedCount: number;
    }
  | {
      type: 'result_success';
      flowId: string;
      result: QueryRuntimeResult;
    }
  | {
      type: 'result_error';
      flowId: string;
      result: QueryRuntimeResult;
    };
