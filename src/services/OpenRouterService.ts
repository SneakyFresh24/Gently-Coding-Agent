// =====================================================
// OpenRouter Service – Direct LLM calls via OpenRouter API
// Compatible interface for direct model orchestration
// =====================================================

import { ApiKeyManager } from './ApiKeyManager';
import { StreamingToolCallProcessor } from '../core/streaming/StreamingToolCallProcessor';
import { StreamChunk, ToolCall as CoreToolCall, UsageInfo } from '../core/streaming/types';
import { TokenTracker } from '../utils/TokenTracker';
import {
    getProviderCacheHints,
    requiresMessageSequenceFix,
    sanitizeSchemaForGemini,
    isGeminiModelFamily,
    getImageMimeFallback,
    ReasoningConfig
} from '../utils/modelPolicy';

export type ToolCall = CoreToolCall;

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
    name?: string;
    pinned?: boolean;
    _compressed?: boolean;
}

export interface ChatRequest {
    messages: ChatMessage[];
    model?: string;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    max_tokens?: number;
    stream?: boolean;
    tools?: any[];
    response_format?: { type: 'json_object' } | { type: 'json_schema', json_schema: any };
    reasoning?: ReasoningConfig;
    plugins?: any[];
    modelPolicyOptions?: {
        providerCachingEnabled?: boolean;
        geminiSchemaSanitizationEnabled?: boolean;
        webpFallbackEnabled?: boolean;
    };
    disableInternalRetries?: boolean;
}

export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

export interface ModelPricing {
    prompt?: number;
    completion?: number;
    cache_read?: number;
    cache_write?: number;
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
const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
    /prompt is too long/i,
    /exceeds the context window/i,
    /input token count.*exceeds/i,
    /maximum context length is \d+ tokens/i,
    /context window exceeds limit/i,
    /exceeded model token limit/i,
    /context length exceeded/i,
    /token limit exceeded/i
];

export class OpenRouterService {
    private toolCallProcessor = new StreamingToolCallProcessor();
    private modelMaxTokensCache: Map<string, number> = new Map();
    private modelContextLengthCache: Map<string, number> = new Map();
    private modelPricingCache: Map<string, ModelPricing> = new Map();

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
        let messages = this.cleanMessages(request.messages);
        if (requiresMessageSequenceFix(model)) {
            messages = this.normalizeMistralMessages(messages);
            messages = this.applyMistralToolUserSequenceGuard(messages);
        }
        messages = this.applyImagePayloadPolicy(
            messages,
            model,
            request.modelPolicyOptions?.webpFallbackEnabled !== false
        );
        const providerCachingEnabled = request.modelPolicyOptions?.providerCachingEnabled !== false;
        if (providerCachingEnabled) {
            messages = this.applyProviderCacheHints(messages);
        }
        const tools = this.sanitizeToolsForModel(
            request.tools,
            model,
            request.modelPolicyOptions?.geminiSchemaSanitizationEnabled !== false
        );

        const body: any = {
            messages,
            stream: request.stream ?? false,
        };
        if (model) body.model = model;

        if (request.temperature !== undefined) body.temperature = request.temperature;
        if (request.top_p !== undefined) body.top_p = request.top_p;
        if (request.top_k !== undefined) body.top_k = request.top_k;
        if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
        if (tools && tools.length > 0) body.tools = tools;
        if (request.response_format) body.response_format = request.response_format;
        if (request.reasoning && Object.keys(request.reasoning).length > 0) body.reasoning = request.reasoning;
        if (request.plugins && request.plugins.length > 0) body.plugins = request.plugins;
        if (providerCachingEnabled) {
            body.providerOptions = getProviderCacheHints('openrouter');
        }

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
        const maxRetries = request.disableInternalRetries ? 0 : 3;
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

                    // Track usage if present (OpenRouter can send this in a final chunk without choices)
                    if (chunk.usage) {
                        const usage: UsageInfo = {
                            prompt_tokens: chunk.usage.prompt_tokens || 0,
                            completion_tokens: chunk.usage.completion_tokens || 0,
                            total_tokens: chunk.usage.total_tokens || 0,
                            cache_read_input_tokens: chunk.usage.cache_read_input_tokens || 0,
                            cache_write_input_tokens: chunk.usage.cache_write_input_tokens || 0
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

                }
            }

            // 6. Emit completed and incomplete tool calls when the stream is finished
            const toolCallResult = this.toolCallProcessor.getStreamingToolCallResult();
            for (const completed of toolCallResult.completedToolCalls) {
                yield { type: 'tool_call_ready', toolCall: completed.toolCall, index: completed.index };
            }
            for (const incomplete of toolCallResult.incompleteToolCalls) {
                yield { type: 'tool_call_incomplete', incomplete, index: -1 };
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

    private applyProviderCacheHints(messages: ChatMessage[]): ChatMessage[] {
        if (!Array.isArray(messages) || messages.length === 0) return messages;
        const cloned = messages.map((message) => ({ ...message })) as Array<ChatMessage & Record<string, any>>;
        const systemIndexes = cloned
            .map((message, index) => ({ message, index }))
            .filter(({ message }) => message.role === 'system')
            .slice(0, 2)
            .map(({ index }) => index);

        const lastStart = Math.max(0, cloned.length - 2);
        const targetIndexes = new Set<number>([...systemIndexes, ...Array.from({ length: cloned.length - lastStart }, (_, i) => lastStart + i)]);

        for (const index of targetIndexes) {
            const target = cloned[index];
            if (!target) continue;
            target.cache_control = { type: 'ephemeral' };
            target.cacheControl = { type: 'ephemeral' };
        }

        return cloned;
    }

    private sanitizeToolsForModel(tools: any[] | undefined, modelId: string | undefined, enabled: boolean): any[] | undefined {
        if (!enabled || !Array.isArray(tools) || tools.length === 0 || !isGeminiModelFamily(modelId)) {
            return tools;
        }
        return tools.map((tool) => {
            if (!tool || typeof tool !== 'object' || !tool.function || typeof tool.function !== 'object') {
                return tool;
            }
            const parameters = (tool.function as any).parameters;
            if (!parameters || typeof parameters !== 'object') return tool;
            return {
                ...tool,
                function: {
                    ...tool.function,
                    parameters: sanitizeSchemaForGemini(parameters)
                }
            };
        });
    }

    private applyImagePayloadPolicy(messages: ChatMessage[], modelId: string | undefined, enabled: boolean): ChatMessage[] {
        if (!enabled || !Array.isArray(messages) || messages.length === 0) return messages;
        return messages.map((message) => {
            const content: any = (message as any).content;
            if (!content || typeof content !== 'object') return message;

            // Hook-point for future multimodal payloads:
            // If content parts carry image mime types, normalize unsupported webp -> png for affected models.
            const patchedContent = this.patchImageMimeNode(content, modelId);
            if (patchedContent === content) return message;
            return { ...(message as any), content: patchedContent };
        });
    }

    private patchImageMimeNode(node: any, modelId: string | undefined): any {
        if (!node || typeof node !== 'object') return node;
        if (Array.isArray(node)) {
            let changed = false;
            const next = node.map((entry) => {
                const patched = this.patchImageMimeNode(entry, modelId);
                if (patched !== entry) changed = true;
                return patched;
            });
            return changed ? next : node;
        }

        const clone: any = { ...node };
        let changed = false;
        for (const key of ['mimeType', 'mime_type', 'mediaType', 'media_type']) {
            if (typeof clone[key] === 'string') {
                const fallback = getImageMimeFallback(modelId, clone[key]);
                if (fallback !== clone[key]) {
                    clone[key] = fallback;
                    changed = true;
                }
            }
        }
        for (const [key, value] of Object.entries(clone)) {
            if (value && typeof value === 'object') {
                const patched = this.patchImageMimeNode(value, modelId);
                if (patched !== value) {
                    clone[key] = patched;
                    changed = true;
                }
            }
        }
        return changed ? clone : node;
    }

    /** List available models from OpenRouter (for UI pickers) */
    async listModels(): Promise<{ id: string; name: string; context_length: number; max_output: number; pricing?: ModelPricing }[]> {
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
                const pricing: ModelPricing | undefined = m.pricing ? {
                    prompt: this.parsePricingValue(m.pricing.prompt),
                    completion: this.parsePricingValue(m.pricing.completion),
                    cache_read: this.parsePricingValue(m.pricing.cache_read),
                    cache_write: this.parsePricingValue(m.pricing.cache_write)
                } : undefined;
                // Update cache while we vary the list
                this.modelMaxTokensCache.set(m.id, maxOutput);
                this.modelContextLengthCache.set(m.id, contextLength);
                if (pricing) {
                    this.modelPricingCache.set(m.id, pricing);
                }
                return {
                    id: m.id,
                    name: m.name,
                    context_length: contextLength,
                    max_output: maxOutput,
                    pricing
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

    async getModelPricing(modelId: string): Promise<ModelPricing | null> {
        if (this.modelPricingCache.has(modelId)) {
            return this.modelPricingCache.get(modelId) || null;
        }

        const models = await this.listModels();
        const model = models.find(m => m.id === modelId);
        if (model?.pricing) {
            this.modelPricingCache.set(modelId, model.pricing);
            return model.pricing;
        }
        return null;
    }

    isContextLengthError(error: unknown): error is OpenRouterHttpError {
        if (!(error instanceof OpenRouterHttpError)) return false;
        if (error.status !== 400) return false;

        const msg = (error.message || '').toLowerCase();
        if (error.code === 'context_length_exceeded') return true;
        if (msg.includes('requested about') || msg.includes('reduce the length')) return true;
        return CONTEXT_OVERFLOW_PATTERNS.some((pattern) => pattern.test(msg));
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

    isToolCallSequenceError(error: unknown): boolean {
        const message = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
        return (
            message.includes('tool call result does not follow tool call') ||
            message.includes('tool_result does not follow tool_call') ||
            message.includes('tool call') && message.includes('does not follow') ||
            message.includes('invalid params') && message.includes('tool') ||
            message.includes('invalid function arguments') ||
            message.includes('context window exceeds limit')
        );
    }

    private normalizeMistralMessages(messages: ChatMessage[]): ChatMessage[] {
        const cloned = messages.map((message) => ({
            ...message,
            tool_calls: Array.isArray(message.tool_calls)
                ? message.tool_calls.map((toolCall) => ({ ...toolCall, function: { ...toolCall.function } }))
                : message.tool_calls
        }));
        const idMap = new Map<string, string>();
        const usedIds = new Set<string>();

        for (const message of cloned) {
            if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
            message.tool_calls = message.tool_calls.map((toolCall) => {
                const rawId = String(toolCall?.id || 'toolcall');
                const normalizedId = this.makeUniqueMistralId(rawId, usedIds);
                idMap.set(rawId, normalizedId);
                return { ...toolCall, id: normalizedId };
            });
        }

        for (const message of cloned) {
            if (message.role !== 'tool' || !message.tool_call_id) continue;
            const rawId = String(message.tool_call_id);
            message.tool_call_id = idMap.get(rawId) || this.makeUniqueMistralId(rawId, usedIds);
        }

        return cloned;
    }

    private applyMistralToolUserSequenceGuard(messages: ChatMessage[]): ChatMessage[] {
        const guarded: ChatMessage[] = [];
        for (const message of messages) {
            const previous = guarded[guarded.length - 1];
            if (previous?.role === 'tool' && message.role === 'user') {
                guarded.push({ role: 'assistant', content: 'Done.' });
            }
            guarded.push(message);
        }
        return guarded;
    }

    private makeUniqueMistralId(rawId: string, usedIds: Set<string>): string {
        const base = this.normalizeMistralId(rawId);
        if (!usedIds.has(base)) {
            usedIds.add(base);
            return base;
        }

        let attempt = 1;
        while (attempt < 10_000) {
            const suffix = attempt.toString(36).slice(-2).padStart(2, '0');
            const candidate = `${base.slice(0, 7)}${suffix}`.slice(0, 9);
            if (!usedIds.has(candidate)) {
                usedIds.add(candidate);
                return candidate;
            }
            attempt += 1;
        }

        return base;
    }

    private normalizeMistralId(id: string): string {
        const alphanumeric = (id || '').replace(/[^a-zA-Z0-9]/g, '');
        return (alphanumeric || 'toolcall0').slice(0, 9).padEnd(9, '0');
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

    private parsePricingValue(value: unknown): number | undefined {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : undefined;
        }
        if (typeof value === 'string') {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }

    dispose(): void {
        console.log('[OpenRouterService] Disposed');
    }
}
