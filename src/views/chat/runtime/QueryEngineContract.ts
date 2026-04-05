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
  | 'PLAN_RESUME_NO_PROGRESS'
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
  | ({ runId?: string } & {
      type: 'system_init';
      model: string;
      flowId: string;
      maxTurns: number;
      maxBudgetUsd: number | null;
      maxStructuredOutputRetries: number;
    })
  | ({ runId?: string } & {
      type: 'turn_transition';
      flowId: string;
      from: string;
      to: string;
      reason: string;
    })
  | ({ runId?: string } & {
      type: 'query_attempt';
      flowId: string;
      attempt: number;
      maxAttempts: number;
    })
  | ({ runId?: string } & {
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
    })
  | ({ runId?: string } & {
      type: 'tool_summary';
      flowId: string;
      toolCalls: number;
      incompleteToolCalls: number;
    })
  | ({ runId?: string } & {
      type: 'compaction_boundary';
      flowId: string;
      reason: 'budget' | 'overflow_rescue';
      droppedCount: number;
    })
  | ({ runId?: string } & {
      type: 'result_success';
      flowId: string;
      result: QueryRuntimeResult;
    })
  | ({ runId?: string } & {
      type: 'result_error';
      flowId: string;
      result: QueryRuntimeResult;
    });
