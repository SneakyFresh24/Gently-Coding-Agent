// =====================================================
// OpenRouter Service – Direct LLM calls via OpenRouter API
// Compatible interface for direct model orchestration
// =====================================================

import { ApiKeyManager } from './ApiKeyManager';
import { StreamingToolCallProcessor } from '../core/streaming/StreamingToolCallProcessor';
import { StreamChunk, ToolCall as CoreToolCall, UsageInfo } from '../core/streaming/types';
import { TokenTracker } from '../utils/TokenTracker';

export type ToolCall = CoreToolCall;

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
    name?: string;
}

export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    tools?: any[];
    response_format?: { type: 'json_object' } | { type: 'json_schema', json_schema: any };
    plugins?: any[];
}

export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

export class OpenRouterHttpError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly model?: string;
    readonly maxTokens?: number;
    readonly retryAfterMs?: number;
    readonly metadata?: any;

    constructor(params: {
        status: number;
        message: string;
        code?: string;
        model?: string;
        maxTokens?: number;
        retryAfterMs?: number;
        metadata?: any;
    }) {
        super(params.message);
        this.name = 'OpenRouterHttpError';
        this.status = params.status;
        this.code = params.code;
        this.model = params.model;
        this.maxTokens = params.maxTokens;
        this.retryAfterMs = params.retryAfterMs;
        this.metadata = params.metadata;
    }
}

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const APP_SITE = 'https://github.com/gently-ai/gently-vscode-extension';
const APP_TITLE = 'Gently - AI Coding Agent';

export class OpenRouterService {
    private toolCallProcessor = new StreamingToolCallProcessor();
    private modelMaxTokensCache: Map<string, number> = new Map();
    private modelContextLengthCache: Map<string, number> = new Map();

    constructor(
        private readonly apiKeyManager: ApiKeyManager,
        private readonly tokenTracker?: TokenTracker
    ) { }

    // ─── Core request ──────────────────────────────────────────────────────────

    private async buildHeaders(): Promise<Record<string, string>> {
        const key = await this.apiKeyManager.getKey();
        if (!key) {
            throw new Error('No OpenRouter API key configured. Please set your key via the Gently settings.');
        }
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`,
            'HTTP-Referer': APP_SITE,
            'X-Title': APP_TITLE,
        };
    }

    async sendChatMessage(request: ChatRequest): Promise<Response> {
        const headers = await this.buildHeaders();
        const model = request.model;

        // Validate & clean messages
        const messages = this.cleanMessages(request.messages);

        const body: any = {
            messages,
            stream: request.stream ?? false,
        };
        if (model) body.model = model;

        if (request.temperature !== undefined) body.temperature = request.temperature;
        if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
        if (request.tools && request.tools.length > 0) body.tools = request.tools;
        if (request.response_format) body.response_format = request.response_format;
        if (request.plugins && request.plugins.length > 0) body.plugins = request.plugins;

        console.log(`[OpenRouterService] Sending request: model=${model || '<openrouter-default>'}, messages=${messages.length}, stream=${body.stream}`);

        const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let errorData: any = {};
            try { errorData = await response.json(); } catch { }
            console.error('[OpenRouterService] API error:', response.status, errorData);
            const errorMessage = errorData?.error?.message || response.statusText || 'Unknown error';
            const errorCode = errorData?.error?.code;
            const retryAfterMs = this.parseRetryAfterMs(response.headers.get('retry-after'));
            const errorMetadata = errorData?.error?.metadata;

            if (response.status === 401) {
                throw new Error('Invalid OpenRouter API key. Please update your key in Gently settings.');
            }
            if (response.status === 429) {
                throw new OpenRouterHttpError({
                    status: response.status,
                    code: typeof errorCode === 'number' ? String(errorCode) : errorCode,
                    message: `OpenRouter rate limit: ${errorMessage}`,
                    model,
                    maxTokens: request.max_tokens,
                    retryAfterMs,
                    metadata: errorMetadata
                });
            }
            if (response.status >= 500) {
                throw new Error(`OpenRouter server error (${response.status}). Please try again.`);
            }

            throw new OpenRouterHttpError({
                status: response.status,
                code: typeof errorCode === 'number' ? String(errorCode) : errorCode,
                message: `OpenRouter error (${response.status}): ${errorMessage}`,
                model,
                maxTokens: request.max_tokens,
                retryAfterMs,
                metadata: errorMetadata
            });
        }

        return response;
    }

    // ─── Streaming ─────────────────────────────────────────────────────────────

    async *streamChatMessage(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
        let lastError: any;
        const maxRetries = 3;
        const delay = 1000;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const generator = this.internalStreamChatMessage(request);
                for await (const chunk of generator) {
                    yield chunk;
                }
                return; // Success
            } catch (error) {
                if (error instanceof OpenRouterHttpError) {
                    throw error;
                }
                lastError = error;
                if (attempt < maxRetries) {
                    console.warn(`[OpenRouterService] Stream attempt ${attempt + 1} failed, retrying in ${delay}ms...`, error);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        throw lastError;
    }

    private async *internalStreamChatMessage(
        request: ChatRequest
    ): AsyncGenerator<StreamChunk, void, unknown> {
        this.toolCallProcessor.reset();
        
        // Add stream_options to get usage in the final chunk
        const bodyWithUsage = {
            ...request,
            stream: true,
            stream_options: { include_usage: true }
        };
        
        const response = await this.sendChatMessage(bodyWithUsage);

        if (!response.body) throw new Error('No response body from OpenRouter');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    let chunk: any;
                    try { 
                        chunk = JSON.parse(trimmed.slice(6)); 
                    } catch (e) { 
                        console.error('[OpenRouterService] Failed to parse SSE chunk:', trimmed, e);
                        continue; 
                    }

                    // 1. Explicit Error Handling
                    if (chunk.error) {
                        yield { type: 'error', error: new Error(`OpenRouter API Error: ${chunk.error.message || 'Unknown error'}`) };
                        return;
                    }

                    const choice = chunk.choices?.[0];
                    if (!choice) continue;

                    // 2. Mid-stream error detection
                    if (choice.finish_reason === "error") {
                        yield { type: 'error', error: new Error(`Stream Error Choice: ${choice.message || 'The model encountered an error during generation.'}`) };
                        return;
                    }

                    const delta = choice.delta;
                    if (!delta) continue;

                    // 3. Reasoning support (Thinking Tokens)
                    if (delta.reasoning) {
                        yield { type: 'reasoning', reasoning: delta.reasoning };
                    }

                    // 4. Regular text content
                    if (typeof delta.content === 'string' && delta.content) {
                        yield { type: 'text', text: delta.content };
                    }

                    // 5. Tool calls with processor
                    if (delta.tool_calls) {
                        yield* this.toolCallProcessor.processToolCallDeltas(delta.tool_calls);
                    }

                    // 5a. Track usage if present (OpenRouter sends this in a final chunk when include_usage: true)
                    if (chunk.usage) {
                        const usage: UsageInfo = {
                            prompt_tokens: chunk.usage.prompt_tokens || 0,
                            completion_tokens: chunk.usage.completion_tokens || 0,
                            total_tokens: chunk.usage.total_tokens || 0
                        };
                        
                        if (this.tokenTracker) {
                            this.tokenTracker.trackUsage({
                                promptTokens: usage.prompt_tokens,
                                completionTokens: usage.completion_tokens,
                                totalTokens: usage.total_tokens
                            });
                        }
                        
                        yield { type: 'usage', usage };
                    }
                }
            }

            // 6. Emit completed tool calls when the stream is finished
            const completedTools = this.toolCallProcessor.getCompletedToolCalls();
            for (const toolCall of completedTools) {
                yield { type: 'tool_call_ready', toolCall, index: 0 };
            }

        } finally {
            reader.releaseLock();
        }
    }

    // ─── Simple helpers ────────────────────────────────────────────────────────

    async sendSimpleMessage(message: string, model?: string): Promise<string> {
        const response = await this.sendChatMessage({
            messages: [{ role: 'user', content: message }],
            model,
        });
        const data: any = await response.json();
        
        // Track usage for non-streaming calls
        if (data.usage && this.tokenTracker) {
            this.tokenTracker.trackUsage({
                promptTokens: data.usage.prompt_tokens || 0,
                completionTokens: data.usage.completion_tokens || 0,
                totalTokens: data.usage.total_tokens || 0
            });
        }
        
        return data.choices?.[0]?.message?.content ?? '';
    }

    async sendMessageWithTools(
        message: string,
        tools: any[],
        model?: string
    ): Promise<{ content: string; tool_calls?: ToolCall[] }> {
        const response = await this.sendChatMessage({
            messages: [{ role: 'user', content: message }],
            tools,
            model,
        });
        const data: any = await response.json();
        const choice = data.choices?.[0];
        
        // Convert to our ToolCall type if needed
        const rawToolCalls = choice?.message?.tool_calls || [];
        const toolCalls: ToolCall[] = rawToolCalls.map((tc: any) => ({
            id: tc.id,
            type: 'function',
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments
            }
        }));

        return {
            content: choice?.message?.content ?? '',
            tool_calls: toolCalls,
        };
    }

    /** Simple adapter for use as an LLM provider in iterative planning */
    async sendMessage(messages: ChatMessage[]): Promise<string> {
        return await this.sendSimpleMessage(messages.map(m => m.content).join('\n'));
    }

    // ─── Utility ───────────────────────────────────────────────────────────────

    private cleanMessages(messages: ChatMessage[]): ChatMessage[] {
        return messages.filter(m => {
            if (!m || !m.role) return false;
            // Tool result messages may have empty content — keep them
            if (m.role === 'tool') return true;
            // Assistant messages with tool calls might have empty content — keep them
            if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) return true;
            return typeof m.content === 'string' && m.content.trim() !== '';
        });
    }

    /** List available models from OpenRouter (for UI pickers) */
    async listModels(): Promise<{ id: string; name: string; context_length: number; max_output: number }[]> {
        const key = await this.apiKeyManager.getKey();
        if (!key) return [];

        try {
            const resp = await fetch(`${OPENROUTER_BASE_URL}/models`, {
                headers: { Authorization: `Bearer ${key}` },
            });
            if (!resp.ok) return [];
            const data: any = await resp.json();
            const models = (data.data ?? []).map((m: any) => {
                const maxOutput = m.top_provider?.max_completion_tokens || 0;
                const contextLength = m.context_length ?? 0;
                // Update cache while we vary the list
                this.modelMaxTokensCache.set(m.id, maxOutput);
                this.modelContextLengthCache.set(m.id, contextLength);
                return {
                    id: m.id,
                    name: m.name,
                    context_length: contextLength,
                    max_output: maxOutput,
                };
            });
            return models;
        } catch {
            return [];
        }
    }

    /**
     * Get the dynamic max_output for a given model
     */
    async getMaxTokens(modelId: string): Promise<number> {
        if (this.modelMaxTokensCache.has(modelId)) {
            const cached = this.modelMaxTokensCache.get(modelId);
            if (cached && cached > 0) return cached;
        }

        const models = await this.listModels();
        const model = models.find(m => m.id === modelId);
        return (model?.max_output && model.max_output > 0) ? model.max_output : 8192; // Fallback to 8k
    }

    async getContextLength(modelId: string): Promise<number> {
        if (this.modelContextLengthCache.has(modelId)) {
            const cached = this.modelContextLengthCache.get(modelId);
            if (cached && cached > 0) return cached;
        }

        const models = await this.listModels();
        const model = models.find(m => m.id === modelId);
        return (model?.context_length && model.context_length > 0) ? model.context_length : 200000;
    }

    isContextLengthError(error: unknown): error is OpenRouterHttpError {
        if (!(error instanceof OpenRouterHttpError)) return false;
        if (error.status !== 400) return false;

        const msg = (error.message || '').toLowerCase();
        if (error.code === 'context_length_exceeded') return true;
        return (
            msg.includes('maximum context length') ||
            msg.includes('requested about') ||
            msg.includes('reduce the length') ||
            msg.includes('context length')
        );
    }

    isGuardrailPrivacyError(error: unknown): error is OpenRouterHttpError {
        if (!(error instanceof OpenRouterHttpError)) return false;
        if (error.status !== 404) return false;

        const msg = (error.message || '').toLowerCase();
        return msg.includes('no endpoints available matching your guardrail restrictions') &&
            msg.includes('data policy');
    }

    isRateLimitError(error: unknown): error is OpenRouterHttpError {
        return error instanceof OpenRouterHttpError && error.status === 429;
    }

    private parseRetryAfterMs(retryAfter: string | null): number | undefined {
        if (!retryAfter) return undefined;

        const asSeconds = Number(retryAfter);
        if (Number.isFinite(asSeconds) && asSeconds > 0) {
            return Math.floor(asSeconds * 1000);
        }

        const asDate = Date.parse(retryAfter);
        if (!Number.isNaN(asDate)) {
            const delta = asDate - Date.now();
            return delta > 0 ? delta : undefined;
        }

        return undefined;
    }

    dispose(): void {
        console.log('[OpenRouterService] Disposed');
    }
}
