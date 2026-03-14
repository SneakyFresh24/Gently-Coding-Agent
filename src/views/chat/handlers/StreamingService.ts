import * as vscode from 'vscode';
import { OpenRouterService, ChatMessage } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

const log = new LogService('StreamingService');

export class StreamingService {
    constructor(
        private readonly openRouterService: OpenRouterService,
        private readonly sendMessageToWebview: (message: any) => void
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
        let assistantMessage = '';
        let toolCalls: any[] = [];
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
                if (choice?.message?.content) assistantMessage = choice.message.content;
                if (choice?.message?.tool_calls) toolCalls = choice.message.tool_calls;
                this.sendMessageToWebview({ type: 'processingEnd' });

                if (assistantMessage) {
                    this.sendMessageToWebview({
                        type: 'assistantMessageFull',
                        content: assistantMessage,
                        messageId: `msg_${Date.now()}`
                    });
                }
            } catch (error) {
                log.error('Non-streaming follow-up failed:', error);
                this.sendMessageToWebview({ type: 'processingEnd' });
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
                            if (assistantMessage === '') {
                                this.sendMessageToWebview({ type: 'processingEnd' });
                                this.sendMessageToWebview({ type: 'generatingStart' });
                            }
                            assistantMessage += chunk.text;
                            this.sendMessageToWebview({ type: 'assistantMessageChunk', chunk: chunk.text });
                            break;

                        case 'reasoning':
                            // Reasoning chunks (Thinking tokens)
                            this.sendMessageToWebview({ type: 'activityUpdate', label: `Thinking...` });
                            // We could also send these to the webview for a "Thinking" block in the UI
                            break;

                        case 'tool_call_start':
                            this.sendMessageToWebview({ 
                                type: 'activityUpdate', 
                                label: `Preparing ${chunk.toolName}...` 
                            });
                            break;

                        case 'tool_call_delta':
                            // Optional: update a specific tool's progress in UI
                            break;

                        case 'tool_call_ready':
                            toolCalls.push(chunk.toolCall);
                            this.sendMessageToWebview({ 
                                type: 'activityUpdate', 
                                label: `Ready: ${chunk.toolCall.function.name}` 
                            });
                            break;

                        case 'error':
                            throw chunk.error;

                        case 'usage':
                            // Handle usage info if needed
                            break;
                    }
                }
            } catch (error) {
                log.error('Streaming failed:', error);
                this.sendMessageToWebview({ type: 'error', message: error instanceof Error ? error.message : String(error) });
                this.sendMessageToWebview({ type: 'processingEnd' });
            }
        }

        return { assistantMessage, toolCalls };
    }
}
