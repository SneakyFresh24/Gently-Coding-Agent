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
import { ModeService } from '../../../modes/ModeService';
import { OpenRouterService } from '../../../services/OpenRouterService';
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
        private readonly modeService: ModeService,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly openRouterService: OpenRouterService,
        private readonly handleGuardrailPrivacyError?: () => Promise<void>
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
            this.sendMessageToWebview({ type: 'activityUpdate', label: 'Denkt nach...' });
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
            await this.generateAndStreamResponse(context, enhancedMessage, retryCount);

        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error('Error in chat flow:', error);
            this.sendMessageToWebview({ type: 'activityUpdate', label: null });
            this.sendMessageToWebview({ type: 'processingEnd' });
            this.sendMessageToWebview({ type: 'generatingEnd' });
            this.sendMessageToWebview({ type: 'error', message: `Error: ${errorMsg}` });
        }
    }

    async generateAndStreamResponse(context: ChatViewContext, message: string, retryCount: number = 0, isFollowUp: boolean = false): Promise<void> {
        if (!context.selectedModel) {
            throw new Error('Please select a model before sending a message.');
        }

        const mode = this.modeService.getCurrentMode();
        const temperature = mode?.temperature ?? 0.7;
        const modelMaxOutput = await this.openRouterService.getMaxTokens(context.selectedModel);
        const modelContextLength = await this.openRouterService.getContextLength(context.selectedModel);

        this.sendMessageToWebview({ type: 'activityUpdate', label: 'Preparing prompt...' });
        const systemPrompt = await this.promptManager.prepareSystemPrompt(context, retryCount);
        // Fix: Removed activityUpdate: null to keep the last status visible until streaming starts
        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...context.conversationHistory.map(toChatMessage),
        ];

        const tools = this.getToolsForMode(context);
        const responseFormat = tools && context.selectedModel === 'deepseek/deepseek-chat' ? { type: 'json_object' as const } : undefined;
        const configuredMaxTokens = this.getConfiguredMaxTokens();
        let maxTokens = this.computeMaxOutputTokens(messages, tools, modelContextLength, modelMaxOutput, configuredMaxTokens);

        // Always send generatingStart to ensure the UI indicator is active,
        // even for follow-up responses (e.g. after tool execution)
        this.sendMessageToWebview({ type: 'generatingStart' });

        context.shouldStopStream = false;
        let rateLimitRetryCount = 0;
        let contextLengthRetried = false;
        let assistantMessage = '';
        let toolCalls: any[] = [];
        while (true) {
            try {
                const result = await this.streamingService.streamResponse(messages, {
                    temperature,
                    maxTokens,
                    model: context.selectedModel,
                    tools,
                    responseFormat,
                    isFollowUp,
                    shouldStopRef: { get current() { return context.shouldStopStream; } } as any
                });
                assistantMessage = result.assistantMessage;
                toolCalls = result.toolCalls;
                break;
            } catch (error) {
                if (this.openRouterService.isRateLimitError(error)) {
                    const maxRateLimitRetries = 2;
                    const retryAttempt = rateLimitRetryCount + 1;
                    const retryDelayMs = this.getRateLimitDelayMs(error.retryAfterMs, retryAttempt);

                    if (!context.shouldStopStream && retryAttempt <= maxRateLimitRetries) {
                        log.warn(`Rate limit detected. Retrying attempt ${retryAttempt}/${maxRateLimitRetries} in ${retryDelayMs}ms (model=${context.selectedModel})`);
                        log.info(`Rate-limit retry planned: attempt=${retryAttempt} delayMs=${retryDelayMs} model=${context.selectedModel} max_tokens=${maxTokens}`);
                        this.sendMessageToWebview({
                            type: 'retryingRateLimit',
                            attempt: retryAttempt,
                            maxAttempts: maxRateLimitRetries,
                            delayMs: retryDelayMs,
                            model: context.selectedModel
                        } as any);
                        this.sendMessageToWebview({ type: 'activityUpdate', label: `Provider busy. Retrying in ${Math.ceil(retryDelayMs / 1000)}s...` });
                        await this.sleepWithStop(retryDelayMs, context);
                        if (context.shouldStopStream) {
                            throw new Error('Request stopped by user.');
                        }
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        rateLimitRetryCount += 1;
                        continue;
                    }

                    const freeModelHint = context.selectedModel.includes(':free')
                        ? ' Free providers are often saturated. Try again shortly or choose another model.'
                        : '';
                    log.error(`Rate limit retries exhausted: status=429 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                    throw new Error(`Provider is currently rate-limited. Please wait and retry.${freeModelHint}`);
                }

                if (this.openRouterService.isGuardrailPrivacyError(error)) {
                    log.error(`Guardrail privacy mismatch: status=404 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                    if (this.handleGuardrailPrivacyError) {
                        await this.handleGuardrailPrivacyError();
                    }
                    throw new Error('OpenRouter blocked this request due to privacy/guardrail settings. To use free models, enable "free endpoints that may publish prompts" in https://openrouter.ai/settings/privacy');
                }

                if (
                    !contextLengthRetried &&
                    !context.shouldStopStream &&
                    this.openRouterService.isContextLengthError(error)
                ) {
                    const reduced = Math.max(256, Math.floor(maxTokens * 0.75));
                    if (reduced < maxTokens) {
                        log.info(`Retry planned with reduced max_tokens ${maxTokens} -> ${reduced} (model=${context.selectedModel})`);
                        log.warn(`Context-length exceeded. Retrying once with reduced max_tokens ${maxTokens} -> ${reduced} (model=${context.selectedModel})`);
                        this.sendMessageToWebview({ type: 'retryingWithReducedTokens', originalMax: maxTokens, newMax: reduced, reason: 'context_length' } as any);
                        this.sendMessageToWebview({ type: 'activityUpdate', label: 'Retrying with reduced output tokens...' });
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        maxTokens = reduced;
                        contextLengthRetried = true;
                        continue;
                    }
                }

                if (this.openRouterService.isContextLengthError(error)) {
                    log.error(`Context-length retry failed: status=400 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                } else {
                    log.error(`OpenRouter request failed: model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                }
                throw error;
            }
        }

        if (assistantMessage.length > 0 || toolCalls.length > 0) {
            await this.completeStreaming(context, assistantMessage, toolCalls, isFollowUp);
            this.sendMessageToWebview({ type: 'generatingEnd' });
        }
        
        // Ensure activity label is cleared after LLM completes (regardless of content)
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });
    }

    private async completeStreaming(context: ChatViewContext, assistantMessage: string, toolCalls: any[], isFollowUp: boolean): Promise<void> {
        const messageId = `msg-${Date.now()}`;
        const assistantMsg: Message = { id: messageId, timestamp: Date.now(), role: 'assistant', content: assistantMessage, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };

        context.conversationHistory.push(assistantMsg);
        this.sendMessageToWebview({ type: 'assistantMessageEnd', messageId });
        this.sendMessageToWebview({ type: 'generatingEnd' });
        
        await this.sessionHistoryManager.saveMessageToHistory(assistantMsg);

        // Clear activity label after saving to history
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });

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
        const mode = this.modeService.getCurrentMode();
        if (!mode) return this.agentManager.getFormattedTools();

        const tools = mode.getToolsForMode(this.agentManager);
        log.info(`getToolsForMode: mode=${mode.id}, returning ${tools?.length || 0} tools`);
        return tools;
    }

    private estimateInputTokens(messages: Array<{ content: string; tool_calls?: any[] }>, tools?: any[]): number {
        const joinedContent = messages.map((m) => m.content || '').join('\n');
        const toolCallContent = messages
            .map((m) => (m.tool_calls && m.tool_calls.length > 0 ? JSON.stringify(m.tool_calls) : ''))
            .join('\n');
        const toolDefs = tools && tools.length > 0 ? JSON.stringify(tools) : '';
        const rawChars = joinedContent.length + toolCallContent.length + toolDefs.length;
        const rawEstimate = Math.ceil(rawChars / 4);
        return Math.ceil(rawEstimate * 1.15);
    }

    private getConfiguredMaxTokens(): number {
        const configured = vscode.workspace.getConfiguration('gently').get<number>('maxTokens');
        if (typeof configured === 'number' && configured > 0) return configured;
        return Number.MAX_SAFE_INTEGER;
    }

    private computeMaxOutputTokens(
        messages: Array<{ content: string; tool_calls?: any[] }>,
        tools: any[] | undefined,
        modelContextLength: number,
        modelMaxOutput: number,
        userConfiguredMax: number
    ): number {
        const baseReserve = 1024;
        const estimatedInput = this.estimateInputTokens(messages, tools);
        const safeMax = modelContextLength - estimatedInput - baseReserve;
        const bounded = Math.min(userConfiguredMax, modelMaxOutput, safeMax);
        return Math.max(256, bounded);
    }

    private getRateLimitDelayMs(retryAfterMs: number | undefined, retryAttempt: number): number {
        const backoff = Math.pow(2, retryAttempt - 1) * 1000;
        if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
            return Math.max(backoff, retryAfterMs);
        }
        return backoff;
    }

    private async sleepWithStop(delayMs: number, context: ChatViewContext): Promise<void> {
        const step = 100;
        let elapsed = 0;
        while (elapsed < delayMs) {
            if (context.shouldStopStream) return;
            await new Promise((resolve) => setTimeout(resolve, Math.min(step, delayMs - elapsed)));
            elapsed += step;
        }
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
