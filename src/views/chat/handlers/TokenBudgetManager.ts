import { ChatMessage } from '../../../services/OpenRouterService';
import { Tiktoken, encoding_for_model, get_encoding } from 'tiktoken';

const MODEL_ENCODING_FALLBACK = 'cl100k_base';
const MIN_CONTENT_TOKENS = 64;

export interface CompressionResult {
    messages: ChatMessage[];
    inputTokens: number;
    droppedMessages: number;
    wasCompressed: boolean;
}

export class TokenBudgetManager {
    private encoderByModel: Map<string, Tiktoken> = new Map();

    estimateInputTokens(messages: ChatMessage[], tools?: any[]): number {
        const encoder = this.getEncoderForModel('gpt-4o-mini');
        const messageTokens = messages.reduce((sum, message) => {
            const toolCallText = message.tool_calls && message.tool_calls.length > 0
                ? JSON.stringify(message.tool_calls)
                : '';
            // Add a small per-message overhead for role/name delimiters.
            return sum + this.countTextTokens(encoder, message.content || '') + this.countTextTokens(encoder, toolCallText) + 4;
        }, 0);
        const toolTokens = tools && tools.length > 0
            ? this.countTextTokens(encoder, JSON.stringify(tools))
            : 0;
        return messageTokens + toolTokens;
    }

    compressMessagesForBudget(
        modelId: string,
        messages: ChatMessage[],
        tools: any[] | undefined,
        inputBudgetTokens: number
    ): CompressionResult {
        if (messages.length === 0) {
            return { messages, inputTokens: 0, droppedMessages: 0, wasCompressed: false };
        }

        const encoder = this.getEncoderForModel(modelId);
        const [systemMessage, ...history] = messages;
        const toolTokens = tools && tools.length > 0
            ? this.countTextTokens(encoder, JSON.stringify(tools))
            : 0;
        const systemTokens = this.countMessageTokens(encoder, systemMessage);

        const baseTokens = systemTokens + toolTokens;
        if (baseTokens >= inputBudgetTokens) {
            return {
                messages: [systemMessage],
                inputTokens: baseTokens,
                droppedMessages: history.length,
                wasCompressed: true
            };
        }

        let remaining = inputBudgetTokens - baseTokens;
        const selected: ChatMessage[] = [];

        for (let i = history.length - 1; i >= 0; i--) {
            const message = history[i];
            const tokens = this.countMessageTokens(encoder, message);
            if (tokens <= remaining) {
                selected.unshift(message);
                remaining -= tokens;
            }
        }

        if (selected.length === 0 && history.length > 0) {
            const newest = history[history.length - 1];
            const safeBudget = Math.max(MIN_CONTENT_TOKENS, remaining - 8);
            const truncated = this.truncateMessageToBudget(encoder, newest, safeBudget);
            selected.push(truncated);
        }

        const finalMessages = [systemMessage, ...selected];
        const finalTokens = this.estimateInputTokensWithEncoder(encoder, finalMessages, tools);

        return {
            messages: finalMessages,
            inputTokens: finalTokens,
            droppedMessages: Math.max(0, history.length - selected.length),
            wasCompressed: history.length !== selected.length
        };
    }

    dispose(): void {
        for (const encoder of this.encoderByModel.values()) {
            encoder.free();
        }
        this.encoderByModel.clear();
    }

    private truncateMessageToBudget(encoder: Tiktoken, message: ChatMessage, tokenBudget: number): ChatMessage {
        if (tokenBudget <= 0 || !message.content) {
            return { ...message, content: '' };
        }

        const encoded = encoder.encode(message.content);
        if (encoded.length <= tokenBudget) {
            return message;
        }

        const sliced = encoded.slice(encoded.length - tokenBudget);
        const truncatedBytes = encoder.decode(sliced);
        const truncated = Buffer.from(truncatedBytes).toString('utf8');
        return { ...message, content: truncated };
    }

    private getEncoderForModel(modelId: string): Tiktoken {
        const cached = this.encoderByModel.get(modelId);
        if (cached) return cached;

        const normalized = this.normalizeModelId(modelId);
        let encoder: Tiktoken;
        try {
            encoder = encoding_for_model(normalized as any);
        } catch {
            encoder = get_encoding(MODEL_ENCODING_FALLBACK);
        }

        this.encoderByModel.set(modelId, encoder);
        return encoder;
    }

    private normalizeModelId(modelId: string): string {
        const lower = (modelId || '').toLowerCase();
        const slashIndex = lower.indexOf('/');
        const modelPart = slashIndex >= 0 ? lower.slice(slashIndex + 1) : lower;

        if (modelPart.includes('gpt-4.1')) return 'gpt-4.1';
        if (modelPart.includes('gpt-4o-mini')) return 'gpt-4o-mini';
        if (modelPart.includes('gpt-4o')) return 'gpt-4o';
        if (modelPart.includes('gpt-5-mini')) return 'gpt-5-mini';
        if (modelPart.includes('gpt-5')) return 'gpt-5';

        return 'gpt-4o-mini';
    }

    private countMessageTokens(encoder: Tiktoken, message: ChatMessage): number {
        const toolCallText = message.tool_calls && message.tool_calls.length > 0
            ? JSON.stringify(message.tool_calls)
            : '';
        return this.countTextTokens(encoder, message.content || '') + this.countTextTokens(encoder, toolCallText) + 4;
    }

    private estimateInputTokensWithEncoder(encoder: Tiktoken, messages: ChatMessage[], tools?: any[]): number {
        const messageTokens = messages.reduce((sum, message) => sum + this.countMessageTokens(encoder, message), 0);
        const toolTokens = tools && tools.length > 0
            ? this.countTextTokens(encoder, JSON.stringify(tools))
            : 0;
        return messageTokens + toolTokens;
    }

    private countTextTokens(encoder: Tiktoken, text: string): number {
        if (!text) return 0;
        return encoder.encode(text).length;
    }
}
