import { IncompleteToolCall } from '../../../core/streaming/types';

export class StreamContractViolationError extends Error {
  readonly code: 'STREAM_CONTRACT_MISSING_STOP' | 'STREAM_CONTRACT_EMPTY_RESPONSE';

  constructor(code: 'STREAM_CONTRACT_MISSING_STOP' | 'STREAM_CONTRACT_EMPTY_RESPONSE', message: string) {
    super(message);
    this.name = 'StreamContractViolationError';
    this.code = code;
  }
}

export interface StreamContractValidationInput {
  streamTerminated: boolean;
  stoppedByUser: boolean;
  assistantMessage: string;
  toolCalls: any[];
  incompleteToolCalls: IncompleteToolCall[];
}

export class StreamContractEngine {
  assertTerminated(input: StreamContractValidationInput): void {
    if (input.streamTerminated || input.stoppedByUser) return;
    throw new StreamContractViolationError(
      'STREAM_CONTRACT_MISSING_STOP',
      'assistant stream ended without a terminal stop event'
    );
  }

  isStrictlyEmptyAssistantResponse(input: StreamContractValidationInput): boolean {
    return (
      !input.stoppedByUser &&
      input.assistantMessage.trim().length === 0 &&
      input.toolCalls.length === 0 &&
      input.incompleteToolCalls.length === 0
    );
  }

  assertNotStrictlyEmpty(input: StreamContractValidationInput): void {
    if (!this.isStrictlyEmptyAssistantResponse(input)) return;
    throw new StreamContractViolationError(
      'STREAM_CONTRACT_EMPTY_RESPONSE',
      'assistant stream completed without text, tool calls, or incomplete tool calls'
    );
  }
}

