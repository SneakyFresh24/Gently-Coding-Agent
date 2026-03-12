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

                if (assistantMessage === '') {
                    this.sendMessageToWebview({ type: 'processingEnd' });
                    this.sendMessageToWebview({ type: 'generatingStart' });
                }

                const chunkData = chunk as any;
                if (typeof chunkData === 'object' && chunkData.tool_calls) {
                    toolCalls = chunkData.tool_calls;
                } else if (typeof chunkData === 'string') {
                    assistantMessage += chunkData;
                    this.sendMessageToWebview({ type: 'assistantMessageChunk', chunk: chunkData });
                }
            }
        }

        return { assistantMessage, toolCalls };
    }
}
