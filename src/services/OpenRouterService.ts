// =====================================================
// OpenRouter Service – Direct LLM calls via OpenRouter API
// Compatible interface for direct model orchestration
// =====================================================

import { ApiKeyManager } from './ApiKeyManager';
import * as vscode from 'vscode';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
    name?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
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

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const APP_SITE = 'https://github.com/gently-ai/gently-vscode-extension';
const APP_TITLE = 'Gently - AI Coding Agent';

export class OpenRouterService {
    constructor(private readonly apiKeyManager: ApiKeyManager) { }

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

    private getModel(): string {
        try {
            return vscode.workspace.getConfiguration('gently').get<string>('selectedModel') || 'deepseek/deepseek-chat';
        } catch {
            return 'deepseek/deepseek-chat';
        }
    }

    async sendChatMessage(request: ChatRequest): Promise<Response> {
        const headers = await this.buildHeaders();
        const model = request.model || this.getModel();

        // Validate & clean messages
        const messages = this.cleanMessages(request.messages);

        const body: any = {
            model,
            messages,
            stream: request.stream ?? false,
        };

        if (request.temperature !== undefined) body.temperature = request.temperature;
        if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
        if (request.tools && request.tools.length > 0) body.tools = request.tools;
        if (request.response_format) body.response_format = request.response_format;
        if (request.plugins && request.plugins.length > 0) body.plugins = request.plugins;

        console.log(`[OpenRouterService] Sending request: model=${model}, messages=${messages.length}, stream=${body.stream}`);

        const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let errorData: any = {};
            try { errorData = await response.json(); } catch { }
            console.error('[OpenRouterService] API error:', response.status, errorData);

            if (response.status === 401) {
                throw new Error('Invalid OpenRouter API key. Please update your key in Gently settings.');
            }
            if (response.status === 429) {
                const msg = errorData?.error?.message || 'Rate limit exceeded';
                throw new Error(`OpenRouter rate limit: ${msg}`);
            }
            if (response.status >= 500) {
                throw new Error(`OpenRouter server error (${response.status}). Please try again.`);
            }
            throw new Error(`OpenRouter error (${response.status}): ${errorData?.error?.message || response.statusText}`);
        }

        return response;
    }

    // ─── Streaming ─────────────────────────────────────────────────────────────

    async *streamChatMessage(
        request: ChatRequest
    ): AsyncGenerator<string | { tool_calls: any[] } | { type: string; index: number; tool_call: any }, void, unknown> {
        const response = await this.sendChatMessage({ ...request, stream: true });

        if (!response.body) throw new Error('No response body from OpenRouter');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Tracks streaming tool call construction
        const toolCallMap: Map<number, any> = new Map();

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
                    try { chunk = JSON.parse(trimmed.slice(6)); } catch { continue; }

                    const delta = chunk.choices?.[0]?.delta;
                    if (!delta) continue;

                    // Regular text content
                    if (typeof delta.content === 'string' && delta.content) {
                        yield delta.content;
                    }

                    // Streaming tool calls
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index ?? 0;
                            if (!toolCallMap.has(idx)) {
                                toolCallMap.set(idx, {
                                    id: tc.id ?? '',
                                    type: 'function',
                                    function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
                                });
                                // Notify frontend that a tool call started
                                yield { type: 'tool_call_start', index: idx, tool_call: toolCallMap.get(idx) };
                            } else {
                                const existing = toolCallMap.get(idx)!;
                                if (tc.id) existing.id = tc.id;
                                if (tc.function?.name) existing.function.name += tc.function.name;
                                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                            }
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        // Emit completed tool calls
        if (toolCallMap.size > 0) {
            yield { tool_calls: Array.from(toolCallMap.values()) };
        }
    }

    // ─── Simple helpers ────────────────────────────────────────────────────────

    async sendSimpleMessage(message: string, model?: string): Promise<string> {
        const response = await this.sendChatMessage({
            messages: [{ role: 'user', content: message }],
            model,
        });
        const data: any = await response.json();
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
        return {
            content: choice?.message?.content ?? '',
            tool_calls: choice?.message?.tool_calls,
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
            return (data.data ?? []).map((m: any) => ({
                id: m.id,
                name: m.name,
                context_length: m.context_length ?? 0,
                max_output: m.top_provider?.max_completion_tokens ?? 0,
            }));
        } catch {
            return [];
        }
    }

    dispose(): void {
        console.log('[OpenRouterService] Disposed');
    }
}
