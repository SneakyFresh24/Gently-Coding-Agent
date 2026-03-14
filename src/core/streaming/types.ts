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

export interface UsageInfo {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
}

export type StreamChunk = 
    | { type: 'text'; text: string }
    | { type: 'tool_call_start'; toolCallId: string; toolName: string; index: number }
    | { type: 'tool_call_delta'; toolCallId: string; delta: string; index: number }
    | { type: 'tool_call_ready'; toolCall: ToolCall; index: number }
    | { type: 'reasoning'; reasoning: string }
    | { type: 'usage'; usage: UsageInfo }
    | { type: 'error'; error: Error };

export interface ContentChunk {
    type: 'text' | 'reasoning';
    content: string;
}

export interface UsageChunk {
    usage: UsageInfo;
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
