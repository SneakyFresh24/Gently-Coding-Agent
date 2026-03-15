import { ToolCall, ToolCallDelta, PartialMessageUpdate } from './types';

export class StreamResponseHandler {
    private accumulatingContent: string = '';
    private accumulatingReasoning: string = '';
    private toolCallDeltas: Record<number, ToolCallDelta> = {};

    /**
     * Processes a text delta chunk.
     */
    public processTextDelta(delta: string): PartialMessageUpdate {
        this.accumulatingContent += delta;
        return { content: delta };
    }

    /**
     * Processes a reasoning delta chunk.
     */
    public processReasoningDelta(delta: string): PartialMessageUpdate {
        this.accumulatingReasoning += delta;
        return { reasoning: delta };
    }

    /**
     * Processes a tool call delta chunk.
     */
    public processToolCallDelta(toolCallId: string, delta: string, index: number): PartialMessageUpdate {
        if (!this.toolCallDeltas[index]) {
            this.toolCallDeltas[index] = {
                index,
                id: toolCallId,
                function: { arguments: '' }
            };
        }

        if (this.toolCallDeltas[index].function) {
            this.toolCallDeltas[index].function!.arguments += delta;
        }

        return {
            toolCallDeltas: {
                [index]: { ...this.toolCallDeltas[index] }
            }
        };
    }

    /**
     * Returns the full state accumulated so far.
     */
    public getFullState(): { content: string; reasoning: string; toolCalls: ToolCall[] } {
        const toolCalls: ToolCall[] = Object.values(this.toolCallDeltas).map(delta => ({
            id: delta.id || '',
            type: 'function' as const,
            function: {
                name: delta.function?.name || '',
                arguments: delta.function?.arguments || ''
            }
        }));

        return {
            content: this.accumulatingContent,
            reasoning: this.accumulatingReasoning,
            toolCalls
        };
    }

    /**
     * Used when a tool call is finalized/ready.
     */
    public setToolCallReady(index: number, toolCall: ToolCall) {
        this.toolCallDeltas[index] = {
            index,
            id: toolCall.id,
            type: 'function',
            function: {
                name: toolCall.function.name,
                arguments: toolCall.function.arguments
            }
        };
    }
}
