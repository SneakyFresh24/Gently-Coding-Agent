import { ToolCall, StreamChunk, ToolCallDelta, StreamingToolCallResult } from './types';
import { sanitizeJsonArguments } from './JsonSanitizer';
import { repairAndParseJSON } from '../../utils/jsonRepair';

interface ToolCallState {
    id: string;
    name: string;
    arguments: string;
    isReady: boolean;
    hasEmittedStart: boolean;
}

/**
 * Stateful processor for reconstructing tool calls from streaming chunks.
 */
export class StreamingToolCallProcessor {
    private toolCallStateByIndex: Map<number, ToolCallState> = new Map();

    /**
     * Processes tool call deltas and yields stream chunks for new or updated tool calls.
     */
    *processToolCallDeltas(deltas: ToolCallDelta[]): Generator<StreamChunk> {
        for (const tc of deltas) {
            const index = tc.index;
            
            if (!this.toolCallStateByIndex.has(index)) {
                // New tool call started
                const newState: ToolCallState = {
                    id: tc.id || '',
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments || '',
                    isReady: false,
                    hasEmittedStart: false
                };
                this.toolCallStateByIndex.set(index, newState);
                
                // Yield start if we have BOTH id and name immediately (rare but possible)
                if (newState.id && newState.name) {
                    newState.hasEmittedStart = true;
                    yield { 
                        type: 'tool_call_start', 
                        toolCallId: newState.id, 
                        toolName: newState.name,
                        index
                    };
                } else if (newState.name) {
                    // Just yield partial name if ID is missing
                    yield {
                        type: 'tool_call_partial',
                        partialName: newState.name,
                        index
                    };
                }
            } else {
                // Existing tool call update
                const state = this.toolCallStateByIndex.get(index)!;
                
                if (tc.id) {
                    state.id = tc.id;
                    // Yield start only when both ID and Name are present and we haven't emitted yet
                    if (state.id && state.name && !state.hasEmittedStart) {
                        state.hasEmittedStart = true;
                        yield {
                            type: 'tool_call_start',
                            toolCallId: state.id,
                            toolName: state.name,
                            index
                        };
                    }
                }
                
                if (tc.function?.name) {
                    state.name += tc.function.name;
                    // Emit partial name for UI feedback (e.g. "read_f" -> "read_file")
                    yield {
                        type: 'tool_call_partial',
                        partialName: state.name,
                        index
                    };

                    // Yield start only when both ID and Name are present and we haven't emitted yet
                    if (state.id && state.name && !state.hasEmittedStart) {
                        state.hasEmittedStart = true;
                        yield {
                            type: 'tool_call_start',
                            toolCallId: state.id,
                            toolName: state.name,
                            index
                        };
                    }
                }
                
                if (tc.function?.arguments) {
                    state.arguments += tc.function.arguments;
                    yield { 
                        type: 'tool_call_delta', 
                        toolCallId: state.id, 
                        delta: tc.function.arguments,
                        index
                    };
                }
            }
        }
    }

    /**
     * Checks if all tool calls currently being processed are valid and completed.
     * This is typically called at the end of a stream.
     */
    getStreamingToolCallResult(): StreamingToolCallResult {
        const completedToolCalls: Array<{ toolCall: ToolCall; index: number }> = [];
        const incompleteToolCalls: StreamingToolCallResult['incompleteToolCalls'] = [];
        
        for (const [index, state] of this.toolCallStateByIndex.entries()) {
            if (!state.id || !state.name) continue;

            const sanitizedArgs = sanitizeJsonArguments(state.arguments);
            const parseResult = repairAndParseJSON(sanitizedArgs);

            if (parseResult.success) {
                completedToolCalls.push({
                    toolCall: {
                        id: state.id,
                        type: 'function',
                        function: {
                            name: state.name,
                            arguments: sanitizedArgs // Use sanitized version
                        }
                    },
                    index
                });
            } else {
                const reason = parseResult.truncationReason || 'stream_ended_mid_json';
                if (parseResult.isTruncated) {
                    incompleteToolCalls.push({
                        id: state.id,
                        name: state.name,
                        rawArguments: sanitizedArgs,
                        rawArgumentsPreview: (parseResult.rawPreview || sanitizedArgs).slice(0, 500),
                        truncationReason: reason,
                        recoveredFields: parseResult.partialFields || {},
                        charCount: parseResult.charCount || sanitizedArgs.length
                    });
                } else {
                    console.error(`[StreamingToolCallProcessor] Failed to parse tool call ${state.name} at index ${index}:`, parseResult.finalError || parseResult.originalError);
                }
            }
        }

        return { completedToolCalls, incompleteToolCalls };
    }

    getCompletedToolCalls(): Array<{ toolCall: ToolCall; index: number }> {
        return this.getStreamingToolCallResult().completedToolCalls;
    }

    /**
     * Resets the processor state.
     */
    reset(): void {
        this.toolCallStateByIndex.clear();
    }
}
