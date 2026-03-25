import * as vscode from 'vscode';
import { OpenRouterService, ChatMessage } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';
import { StreamResponseHandler } from '../../../core/streaming/StreamResponseHandler';
import { MessageStateHandler } from '../../../core/task/MessageStateHandler';
import { UsageInfo } from '../../../core/streaming/types';
import { IncompleteToolCall } from '../../../core/streaming/types';
import { shouldSkipReasoningForModel } from '../../../utils/modelPolicy';
import type { ReasoningConfig } from '../../../utils/modelPolicy';

const log = new LogService('StreamingService');

export class StreamingService {
    constructor(
        private readonly openRouterService: OpenRouterService,
        private readonly sendMessageToWebview: (message: any) => void,
        private readonly messageStateHandler?: MessageStateHandler
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
    ): Promise<{ assistantMessage: string; toolCalls: any[]; incompleteToolCalls: IncompleteToolCall[]; usage?: UsageInfo }> {
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
                return { assistantMessage, toolCalls, incompleteToolCalls, usage };
            } catch (error) {
                log.error('Non-streaming follow-up failed:', error);
                this.sendMessageToWebview({ type: 'processingEnd' });
                this.sendMessageToWebview({ type: 'generatingEnd' });
                throw error;
            }
        } else {
            let timeoutId: NodeJS.Timeout | undefined;
            const STREAMING_TIMEOUT = 120000;

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
                resetTimeout();
                for await (const chunk of this.openRouterService.streamChatMessage({
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
                    modelPolicyOptions: {
                        providerCachingEnabled,
                        geminiSchemaSanitizationEnabled,
                        webpFallbackEnabled
                    }
                })) {
                    resetTimeout();
                    if (options.shouldStopRef.current) break;

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

                        case 'error':
                            throw chunk.error;
                    }
                }
                
                const finalState = streamHandler.getFullState();
                return { 
                    assistantMessage: finalState.content, 
                    toolCalls: finalState.toolCalls,
                    incompleteToolCalls,
                    usage
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
}
