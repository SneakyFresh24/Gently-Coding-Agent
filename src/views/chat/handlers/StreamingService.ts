import * as vscode from 'vscode';
import { OpenRouterService, ChatMessage } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';
import { StreamResponseHandler } from '../../../core/streaming/StreamResponseHandler';
import { MessageStateHandler } from '../../../core/task/MessageStateHandler';

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
            maxTokens: number;
            model: string;
            tools?: any[];
            responseFormat?: any;
            isFollowUp?: boolean;
            shouldStopRef: { current: boolean };
        }
    ): Promise<{ assistantMessage: string; toolCalls: any[] }> {
        const streamHandler = new StreamResponseHandler();
        const msgIndex = 0; // Default index for the assistant message in this stream

        this.sendMessageToWebview({ type: 'processingStart' });

        if (options.isFollowUp) {
            try {
                const response: any = await this.openRouterService.sendChatMessage({
                    messages,
                    stream: false,
                    temperature: options.temperature,
                    max_tokens: options.maxTokens,
                    tools: options.tools,
                    model: options.model,
                    response_format: options.responseFormat
                });
                const data = await response.json();
                const choice = data.choices?.[0];
                let assistantMessage = '';
                let toolCalls: any[] = [];
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
                return { assistantMessage, toolCalls };
            } catch (error) {
                log.error('Non-streaming follow-up failed:', error);
                this.sendMessageToWebview({ type: 'processingEnd' });
                return { assistantMessage: '', toolCalls: [] };
            }
        } else {
            try {
                for await (const chunk of this.openRouterService.streamChatMessage({
                    messages,
                    stream: true,
                    temperature: options.temperature,
                    max_tokens: options.maxTokens,
                    tools: options.tools,
                    model: options.model,
                    response_format: options.responseFormat
                })) {
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

                        case 'error':
                            throw chunk.error;
                    }
                }
                
                const finalState = streamHandler.getFullState();
                return { 
                    assistantMessage: finalState.content, 
                    toolCalls: finalState.toolCalls 
                };
            } catch (error) {
                log.error('Streaming failed:', error);
                this.sendMessageToWebview({ type: 'error', message: error instanceof Error ? error.message : String(error) });
                this.sendMessageToWebview({ type: 'processingEnd' });
                return { assistantMessage: '', toolCalls: [] };
            }
        }
    }
}
