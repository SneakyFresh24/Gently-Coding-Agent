/**
 * Unified types for the streaming architecture.
 */

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface IncompleteToolCall {
    id: string;
    name: string;
    rawArguments: string;
    rawArgumentsPreview: string;
    truncationReason: 'unterminated_string' | 'unbalanced_braces' | 'stream_ended_mid_json';
    recoveredFields: Record<string, unknown>;
    charCount: number;
}

export interface StreamingToolCallResult {
    completedToolCalls: Array<{ toolCall: ToolCall; index: number }>;
    incompleteToolCalls: IncompleteToolCall[];
}

export interface UsageInfo {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cache_read_input_tokens?: number;
    cache_write_input_tokens?: number;
}

export type StreamRecoveryState = 'STREAMING' | 'DISCONNECTED' | 'RECONNECTING' | 'FAILED';

export type StreamChunk = 
    | { type: 'text'; text: string }
    | { type: 'tool_call_start'; toolCallId: string; toolName: string; index: number }
    | { type: 'tool_call_partial'; partialName: string; index: number }
    | { type: 'tool_call_delta'; toolCallId: string; delta: string; index: number }
    | { type: 'tool_call_ready'; toolCall: ToolCall; index: number }
    | { type: 'tool_call_incomplete'; incomplete: IncompleteToolCall; index: number }
    | { type: 'reasoning'; reasoning: string }
    | { type: 'usage'; usage: UsageInfo }
    | { type: 'message_stop' }
    | { type: 'error'; error: Error }
    | { type: 'partial_update'; index: number; updates: PartialMessageUpdate };

export interface ContentChunk {
    type: 'text' | 'reasoning';
    content: string;
}

export interface UsageChunk {
    usage: UsageInfo;
}

export interface PartialMessageUpdate {
    content?: string;
    reasoning?: string;
    toolCallDeltas?: Record<number, ToolCallDelta>;
}

export interface ToolCallDelta {
    index: number;
    id?: string;
    type?: 'function';
    function?: {
        name?: string;
        arguments?: string;
    };
}
