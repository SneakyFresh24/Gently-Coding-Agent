import { ToolCall, StreamChunk, ToolCallDelta } from './types';
import { sanitizeJsonArguments, tryParseJson } from './JsonSanitizer';

interface ToolCallState {
    id: string;
    name: string;
    arguments: string;
    isReady: boolean;
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
                    isReady: false
                };
                this.toolCallStateByIndex.set(index, newState);
                
                // Eager emission: if we have either Name OR ID, we can start showing it
                if (newState.name) {
                    yield { 
                        type: 'tool_call_start', 
                        toolCallId: newState.id, 
                        toolName: newState.name,
                        index
                    };
                }
            } else {
                // Existing tool call update
                const state = this.toolCallStateByIndex.get(index)!;
                
                if (tc.id) state.id = tc.id;
                
                if (tc.function?.name) {
                    state.name += tc.function.name;
                    // Emit partial name for UI feedback (e.g. "read_f" -> "read_file")
                    yield {
                        type: 'tool_call_partial',
                        partialName: state.name,
                        index
                    };

                    // If we didn't have a name before but now we do, emit start
                    if (state.name.length === tc.function.name.length) {
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
    getCompletedToolCalls(): ToolCall[] {
        const completed: ToolCall[] = [];
        
        for (const [index, state] of this.toolCallStateByIndex.entries()) {
            if (!state.id || !state.name) continue;

            const sanitizedArgs = sanitizeJsonArguments(state.arguments);
            const parseResult = tryParseJson(sanitizedArgs);

            if (parseResult.success) {
                completed.push({
                    id: state.id,
                    type: 'function',
                    function: {
                        name: state.name,
                        arguments: sanitizedArgs // Use sanitized version
                    }
                });
            } else {
                console.error(`[StreamingToolCallProcessor] Failed to parse tool call ${state.name} at index ${index}:`, parseResult.error);
                // We still include it but maybe with a fallback or as is?
                // For now, follow Cline's lead: if it's broken, it's broken.
            }
        }
        
        return completed;
    }

    /**
     * Resets the processor state.
     */
    reset(): void {
        this.toolCallStateByIndex.clear();
    }
}
