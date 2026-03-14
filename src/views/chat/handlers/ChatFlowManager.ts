import * as vscode from 'vscode';
import { ChatViewContext, Message, toChatMessage, fromChatMessage } from '../types/ChatTypes';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { SessionHistoryManager } from './SessionHistoryManager';
import { ReferenceParser, PromptManager, ConversationPruner } from './ContextGenerators';
import { StreamingService } from './StreamingService';
import { ChatHandlerUtils } from './ChatHandlerUtils';
import { ToolCallManager } from '../toolcall';
import { ToolCallDispatcher } from './ExecutionDispatchers';
import { LogService } from '../../../services/LogService';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';

const log = new LogService('ChatFlowManager');

export class ChatFlowManager {
    constructor(
        private readonly agentManager: AgentManager,
        private readonly sessionHistoryManager: SessionHistoryManager,
        private readonly referenceParser: ReferenceParser,
        private readonly promptManager: PromptManager,
        private readonly streamingService: StreamingService,
        private readonly pruner: ConversationPruner,
        private readonly toolCallManager: ToolCallManager,
        private readonly toolCallDispatcher: ToolCallDispatcher,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void
    ) { }

    async handleUserMessage(
        context: ChatViewContext,
        userMessage: string,
        options: { silent: boolean; fileReferences?: any[]; retryCount: number }
    ): Promise<void> {
        const { silent, fileReferences, retryCount } = options;

        if (retryCount === 0) {
            this.sessionHistoryManager.clearToolExecutionTracking(context);
        }

        if (!silent) {
            context.currentFlowId = `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }

        try {
            this.sendMessageToWebview({ type: 'activityUpdate', label: 'Analyzing project...' });
            const { enhancedMessage, loadedReferences } = await this.referenceParser.processMessageWithReferences(userMessage, silent, fileReferences);
            this.sendMessageToWebview({ type: 'activityUpdate', label: 'Pruning conversation...' });

            if (!silent && enhancedMessage) {
                await this.sessionHistoryManager.addMessageToHistory(context, enhancedMessage, userMessage, loadedReferences);
                this.sendMessageToWebview({
                    type: 'userMessage',
                    id: `msg-${Date.now()}`,
                    content: userMessage,
                    timestamp: Date.now(),
                    fileReferences: loadedReferences.map(ref => ({
                        path: ref.path,
                        displayName: ref.displayName,
                        type: ref.type
                    }))
                });
            }

            await this.pruner.pruneConversationHistory(context);
            this.sendMessageToWebview({ type: 'activityUpdate', label: 'Validating history...' });
            this.validateHistory(context);
            this.sendMessageToWebview({ type: 'activityUpdate', label: null }); // Clear custom label before generation
            await this.generateAndStreamResponse(context, enhancedMessage, retryCount);

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error('Error in chat flow:', error);
            this.sendMessageToWebview({ type: 'processingEnd' });
            this.sendMessageToWebview({ type: 'generatingEnd' });
            this.sendMessageToWebview({ type: 'error', message: `Error: ${errorMsg}` });
        }
    }

    async generateAndStreamResponse(context: ChatViewContext, message: string, retryCount: number = 0, isFollowUp: boolean = false): Promise<void> {
        const config = vscode.workspace.getConfiguration('gently');
        const temperature = isFollowUp ? 0.8 : (config.get<number>('temperature') || 0.7);
        const maxTokens = config.get<number>('maxTokens') || 4000;

        this.sendMessageToWebview({ type: 'activityUpdate', label: 'Preparing prompt...' });
        const systemPrompt = await this.promptManager.prepareSystemPrompt(context, retryCount);
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });
        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...context.conversationHistory.map(toChatMessage),
        ];

        const tools = this.getToolsForMode(context);
        const responseFormat = tools && context.selectedModel === 'deepseek-chat' ? { type: 'json_object' as const } : undefined;

        if (!isFollowUp) {
            this.sendMessageToWebview({ type: 'generatingStart' });
        }

        context.shouldStopStream = false;
        const { assistantMessage, toolCalls } = await this.streamingService.streamResponse(messages, {
            temperature,
            maxTokens,
            model: context.selectedModel,
            tools,
            responseFormat,
            isFollowUp,
            shouldStopRef: { get current() { return context.shouldStopStream; } } as any
        });

        if (assistantMessage.length > 0 || toolCalls.length > 0) {
            await this.completeStreaming(context, assistantMessage, toolCalls, isFollowUp);
        } else {
            this.sendMessageToWebview({ type: 'generatingEnd' });
        }
    }

    private async completeStreaming(context: ChatViewContext, assistantMessage: string, toolCalls: any[], isFollowUp: boolean): Promise<void> {
        const messageId = `msg-${Date.now()}`;
        const assistantMsg: Message = { id: messageId, timestamp: Date.now(), role: 'assistant', content: assistantMessage, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };

        context.conversationHistory.push(assistantMsg);
        this.sendMessageToWebview({ type: 'assistantMessageEnd', messageId });
        this.sendMessageToWebview({ type: 'generatingEnd' });
        
        await this.sessionHistoryManager.saveMessageToHistory(assistantMsg);

        if (toolCalls.length > 0) {
            await this.toolCallDispatcher.handleToolCalls(toolCalls, messageId, context);
        }
    }

    private validateHistory(context: ChatViewContext): void {
        const chatMessages = context.conversationHistory.map(toChatMessage);
        const validation = this.toolCallManager.validateConversationHistory(chatMessages);
        if (!validation.valid) {
            const fixed = ChatHandlerUtils.repairConversationHistory(context.conversationHistory);
            if (fixed) context.conversationHistory = fixed.map((m: any) => fromChatMessage(m));
        }
    }

    private getToolsForMode(context: ChatViewContext): any[] | undefined {
        let tools: any[] | undefined;

        if (context.selectedMode === 'architect') {
            const { ArchitectMode } = require('../../../modes/ArchitectMode');
            tools = new ArchitectMode().getToolsForMode(this.agentManager);
        } else if (context.selectedMode === 'code') {
            const { CodeMode } = require('../../../modes/CodeMode');
            const codeMode = new CodeMode();
            const allTools = this.agentManager.getFormattedTools();
            // Only allow tools that CodeMode explicitly declares
            tools = allTools?.filter((t: any) =>
                codeMode.availableTools.includes(t.function?.name)
            );
        } else if (['agent', 'debug'].includes(context.selectedMode) || context.agentMode) {
            tools = this.agentManager.getFormattedTools()
                ?.filter((t: any) => !['replace_file_content'].includes(t.function?.name));
        }

        log.info(`getToolsForMode: mode=${context.selectedMode}, returning ${tools?.length || 0} tools`);
        return tools;
    }

    dispose(): void {
        const anyStreaming = this.streamingService as any;
        if (anyStreaming && typeof anyStreaming.dispose === 'function') anyStreaming.dispose();

        const anyDispatcher = this.toolCallDispatcher as any;
        if (anyDispatcher && typeof anyDispatcher.dispose === 'function') anyDispatcher.dispose();

        const anyPrompt = this.promptManager as any;
        if (anyPrompt && typeof anyPrompt.dispose === 'function') anyPrompt.dispose();

        const anyRef = this.referenceParser as any;
        if (anyRef && typeof anyRef.dispose === 'function') anyRef.dispose();

        const anySession = this.sessionHistoryManager as any;
        if (anySession && typeof anySession.dispose === 'function') anySession.dispose();
    }
}
