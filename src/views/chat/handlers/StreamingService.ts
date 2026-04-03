import * as vscode from 'vscode';
import { OpenRouterService, ChatMessage, OpenRouterHttpError } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';
import { StreamResponseHandler } from '../../../core/streaming/StreamResponseHandler';
import { MessageStateHandler } from '../../../core/task/MessageStateHandler';
import { UsageInfo, StreamRecoveryState } from '../../../core/streaming/types';
import { IncompleteToolCall } from '../../../core/streaming/types';
import { shouldSkipReasoningForModel } from '../../../utils/modelPolicy';
import type { ReasoningConfig } from '../../../utils/modelPolicy';
import { StreamRecoveryManager, isStreamDivergenceError } from '../../../core/streaming/StreamRecoveryManager';
import { telemetry } from '../../../services/Telemetry';
import { HookManager } from '../../../hooks/HookManager';
import { NotificationPayload } from '../../../hooks/types';
import { CircuitBreakerRegistry } from '../../../core/resilience/CircuitBreakerRegistry';

const log = new LogService('StreamingService');

export class StreamingService {
    private readonly circuitBreakers = CircuitBreakerRegistry.getInstance();

    constructor(
        private readonly openRouterService: OpenRouterService,
        private readonly sendMessageToWebview: (message: any) => void,
        private readonly messageStateHandler?: MessageStateHandler,
        private readonly hookManager?: HookManager
    ) { }

    async streamResponse(
        messages: ChatMessage[],
        options: {
            temperature: number;
            topP?: number;
            topK?: number;
            reasoningConfig?: ReasoningConfig;
            maxTokens: number;
            model: string;
            tools?: any[];
            responseFormat?: any;
            isFollowUp?: boolean;
            shouldStopRef: { current: boolean };
        }
    ): Promise<{ assistantMessage: string; toolCalls: any[]; incompleteToolCalls: IncompleteToolCall[]; usage?: UsageInfo; streamTerminated: boolean }> {
        const streamHandler = new StreamResponseHandler();
        const msgIndex = 0; // Default index for the assistant message in this stream
        const config = vscode.workspace.getConfiguration('gently');
        const skipReasoningByModel = config.get<boolean>('modelPolicies.skipReasoningForIncompatibleModels', true);
        const providerCachingEnabled = config.get<boolean>('modelPolicies.providerCaching.enabled', true);
        const geminiSchemaSanitizationEnabled = config.get<boolean>('modelPolicies.geminiSchemaSanitization.enabled', true);
        const webpFallbackEnabled = config.get<boolean>('modelPolicies.webpFallback.enabled', true);

        this.sendMessageToWebview({ type: 'processingStart' });

        if (options.isFollowUp) {
            try {
                const response: any = await this.openRouterService.sendChatMessage({
                    messages,
                    stream: false,
                    temperature: options.temperature,
                    top_p: options.topP,
                    top_k: options.topK,
                    max_tokens: options.maxTokens,
                    tools: options.tools,
                    model: options.model,
                    response_format: options.responseFormat,
                    reasoning: options.reasoningConfig,
                    modelPolicyOptions: {
                        providerCachingEnabled,
                        geminiSchemaSanitizationEnabled,
                        webpFallbackEnabled
                    }
                });
                const data = await response.json();
                const choice = data.choices?.[0];
                let assistantMessage = '';
                let toolCalls: any[] = [];
                let incompleteToolCalls: IncompleteToolCall[] = [];
                const usage: UsageInfo | undefined = data.usage ? {
                    prompt_tokens: data.usage.prompt_tokens || 0,
                    completion_tokens: data.usage.completion_tokens || 0,
                    total_tokens: data.usage.total_tokens || 0,
                    cache_read_input_tokens: data.usage.cache_read_input_tokens || 0,
                    cache_write_input_tokens: data.usage.cache_write_input_tokens || 0
                } : undefined;
                if (choice?.message?.content) assistantMessage = choice.message.content;
                if (choice?.message?.tool_calls) toolCalls = choice.message.tool_calls;
                
                this.sendMessageToWebview({ type: 'processingEnd' });

                if (assistantMessage) {
                    // Send start signal for UI consistency
                    this.sendMessageToWebview({ type: 'generatingStart' });
                    this.sendMessageToWebview({
                        type: 'assistantMessageFull',
                        content: assistantMessage,
                        messageId: `msg_${Date.now()}`
                    });
                }
                return { assistantMessage, toolCalls, incompleteToolCalls, usage, streamTerminated: true };
            } catch (error) {
                log.error('Non-streaming follow-up failed:', error);
                this.sendMessageToWebview({ type: 'processingEnd' });
                this.sendMessageToWebview({ type: 'generatingEnd' });
                throw error;
            }
        } else {
            let timeoutId: NodeJS.Timeout | undefined;
            const STREAMING_TIMEOUT = 120000;
            const maxReconnects = 3;

            const resetTimeout = () => {
                if (timeoutId) clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    log.error('Streaming timeout exceeded (2 min)');
                    options.shouldStopRef.current = true;
                }, STREAMING_TIMEOUT);
            };

            try {
                let usage: UsageInfo | undefined;
                const incompleteToolCalls: IncompleteToolCall[] = [];
                let streamTerminated = false;
                const recovery = new StreamRecoveryManager(1);
                let recoveryState: StreamRecoveryState = 'STREAMING';
                let reconnectAttempt = 0;
                const streamGate = this.circuitBreakers.canExecute('llm.stream');
                if (!streamGate.decision.allowed) {
                    await this.emitRecoveryNotification({
                        channel: 'circuit_breaker',
                        severity: 'warning',
                        action: 'wait',
                        retryAfter: streamGate.decision.retryAfterMs,
                        message: `LLM stream circuit breaker open`,
                        metadata: { circuitKey: streamGate.key }
                    });
                    throw new Error(`CIRCUIT_OPEN_REJECT: Streaming temporarily blocked. Retry after ${streamGate.decision.retryAfterMs || 0}ms.`);
                }
                if (streamGate.transition === 'half_open') {
                    await this.emitRecoveryNotification({
                        channel: 'circuit_breaker',
                        severity: 'warning',
                        action: 'retry',
                        message: `LLM stream circuit breaker half-open`,
                        metadata: { circuitKey: streamGate.key }
                    });
                    log.event('WARN', 'circuit.half_open', 'LLM stream circuit breaker half-open', {
                        circuitKey: streamGate.key
                    });
                }

                await telemetry.withSpan(
                    'stream.session',
                    { model: options.model, 'stream.state': recoveryState },
                    async (streamSpan) => {
                        while (reconnectAttempt <= maxReconnects) {
                            recovery.beginReconnectAttempt();
                            resetTimeout();
                            try {
                                for await (const rawChunk of this.openRouterService.streamChatMessage({
                                    messages,
                                    stream: true,
                                    temperature: options.temperature,
                                    top_p: options.topP,
                                    top_k: options.topK,
                                    max_tokens: options.maxTokens,
                                    tools: options.tools,
                                    model: options.model,
                                    response_format: options.responseFormat,
                                    reasoning: options.reasoningConfig,
                                    disableInternalRetries: true,
                                    modelPolicyOptions: {
                                        providerCachingEnabled,
                                        geminiSchemaSanitizationEnabled,
                                        webpFallbackEnabled
                                    }
                                })) {
                                    resetTimeout();
                                    if (options.shouldStopRef.current) {
                                        recoveryState = 'FAILED';
                                        return;
                                    }

                                    const chunks = recovery.process(rawChunk);
                                    for (const chunk of chunks) {
                                        switch (chunk.type) {
                                            case 'text':
                                                if (streamHandler.getFullState().content === '') {
                                                    this.sendMessageToWebview({ type: 'processingEnd' });
                                                    this.sendMessageToWebview({ type: 'generatingStart' });
                                                }
                                                const textUpdates = streamHandler.processTextDelta(chunk.text);
                                                if (this.messageStateHandler) {
                                                    await this.messageStateHandler.updatePartialMessage(msgIndex, textUpdates);
                                                } else {
                                                    this.sendMessageToWebview({ type: 'assistantMessageChunk', chunk: chunk.text });
                                                }
                                                break;

                                            case 'reasoning':
                                                if (skipReasoningByModel && shouldSkipReasoningForModel(options.model)) {
                                                    log.info(`reasoning skipped for model ${options.model}`);
                                                    break;
                                                }
                                                const reasoningUpdates = streamHandler.processReasoningDelta(chunk.reasoning);
                                                if (this.messageStateHandler) {
                                                    await this.messageStateHandler.updatePartialMessage(msgIndex, reasoningUpdates);
                                                } else {
                                                    this.sendMessageToWebview({ type: 'activityUpdate', label: `Thinking...` });
                                                }
                                                break;

                                            case 'tool_call_start':
                                                this.sendMessageToWebview({
                                                    type: 'activityUpdate',
                                                    label: `Preparing ${chunk.toolName}...`
                                                });
                                                break;

                                            case 'tool_call_delta':
                                                const toolUpdates = streamHandler.processToolCallDelta(chunk.toolCallId, chunk.delta, chunk.index);
                                                if (this.messageStateHandler) {
                                                    await this.messageStateHandler.updatePartialMessage(msgIndex, toolUpdates);
                                                }
                                                break;

                                            case 'tool_call_ready':
                                                streamHandler.setToolCallReady(chunk.index, chunk.toolCall);
                                                this.sendMessageToWebview({
                                                    type: 'activityUpdate',
                                                    label: `Ready: ${chunk.toolCall.function.name}`
                                                });
                                                break;

                                            case 'tool_call_incomplete':
                                                incompleteToolCalls.push(chunk.incomplete);
                                                this.sendMessageToWebview({
                                                    type: 'activityUpdate',
                                                    label: `Truncated: ${chunk.incomplete.name}`
                                                });
                                                break;

                                            case 'usage':
                                                usage = chunk.usage;
                                                break;

                                            case 'message_stop':
                                                streamTerminated = true;
                                                break;

                                            case 'error':
                                                throw chunk.error;
                                        }
                                    }
                                }

                                recoveryState = 'STREAMING';
                                streamSpan.setAttributes({ 'stream.state': recoveryState, 'stream.reconnect_attempts': reconnectAttempt });
                                const successUpdate = this.circuitBreakers.recordSuccess('llm.stream');
                                if (successUpdate.transition === 'closed') {
                                    await this.emitRecoveryNotification({
                                        channel: 'circuit_breaker',
                                        severity: 'info',
                                        message: 'LLM stream circuit breaker closed',
                                        metadata: { circuitKey: successUpdate.key }
                                    });
                                    log.event('INFO', 'circuit.closed', 'LLM stream circuit breaker closed', {
                                        circuitKey: successUpdate.key
                                    });
                                }
                                return;
                            } catch (error) {
                                const isRecoverable = this.isRecoverableStreamingError(error);
                                const breakerUpdate = this.circuitBreakers.recordFailure('llm.stream', isRecoverable);
                                if (breakerUpdate.transition === 'opened') {
                                    await this.emitRecoveryNotification({
                                        channel: 'circuit_breaker',
                                        severity: 'error',
                                        action: 'wait',
                                        message: `LLM stream circuit breaker opened`,
                                        metadata: { circuitKey: breakerUpdate.key }
                                    });
                                    log.event('ERROR', 'circuit.opened', 'LLM stream circuit breaker opened', {
                                        circuitKey: breakerUpdate.key
                                    });
                                }
                                if (!isRecoverable || reconnectAttempt >= maxReconnects || isStreamDivergenceError(error)) {
                                    recoveryState = 'FAILED';
                                    streamSpan.setAttributes({ 'stream.state': recoveryState, 'stream.reconnect_attempts': reconnectAttempt });
                                    streamSpan.recordException(error);
                                    streamSpan.setStatusError(error instanceof Error ? error.message : String(error));
                                    throw error;
                                }

                                reconnectAttempt += 1;
                                recoveryState = 'RECONNECTING';
                                await telemetry.withSpan(
                                    'stream.reconnect_attempt',
                                    {
                                        'retry.attempt': reconnectAttempt,
                                        'stream.state': recoveryState
                                    },
                                    async () => {
                                        streamSpan.addEvent('stream.reconnect_attempt', {
                                            'retry.attempt': reconnectAttempt,
                                            'stream.state': recoveryState
                                        });
                                        this.sendMessageToWebview({
                                            type: 'activityUpdate',
                                            label: `Reconnecting stream... (${reconnectAttempt}/${maxReconnects})`
                                        });
                                        await this.emitRecoveryNotification({
                                            channel: 'recovery',
                                            severity: 'warning',
                                            action: 'retry',
                                            message: `Streaming reconnect attempt ${reconnectAttempt}/${maxReconnects}`,
                                            metadata: { attempt: reconnectAttempt, maxReconnects }
                                        });
                                        const delayMs = Math.min(1000 * (2 ** (reconnectAttempt - 1)), 30_000);
                                        await this.sleep(delayMs);
                                    }
                                );
                                recoveryState = 'STREAMING';
                            }
                        }
                    }
                );
                
                const finalState = streamHandler.getFullState();
                return { 
                    assistantMessage: finalState.content, 
                    toolCalls: finalState.toolCalls,
                    incompleteToolCalls,
                    usage,
                    streamTerminated
                };
            } catch (error) {
                log.error('Streaming failed:', error);
                this.sendMessageToWebview({ type: 'processingEnd' });
                this.sendMessageToWebview({ type: 'generatingEnd' });
                throw error;
            } finally {
                if (timeoutId) clearTimeout(timeoutId);
            }
        }
    }

    private isRecoverableStreamingError(error: unknown): boolean {
        if (error instanceof OpenRouterHttpError) {
            if (error.status === 429) return true;
            return error.status >= 500;
        }

        const message = String((error as any)?.message || error || '').toLowerCase();
        if (!message) return true;
        return (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('fetch') ||
            message.includes('socket') ||
            message.includes('econnreset') ||
            message.includes('stream')
        );
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async emitRecoveryNotification(payload: NotificationPayload): Promise<void> {
        if (!this.hookManager) return;
        await this.hookManager.executeNotification(payload);
    }
}
