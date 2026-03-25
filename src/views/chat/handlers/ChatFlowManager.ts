import * as vscode from 'vscode';
import { ChatViewContext, Message, toChatMessage, fromChatMessage } from '../types/ChatTypes';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { SessionHistoryManager } from './SessionHistoryManager';
import { ReferenceParser, PromptManager, ConversationPruner } from './ContextGenerators';
import { StreamingService } from './StreamingService';
import { ToolCallManager } from '../toolcall';
import { ToolCallDispatcher } from './ExecutionDispatchers';
import { LogService } from '../../../services/LogService';
import { ModeService } from '../../../modes/ModeService';
import { ChatMessage, ModelPricing, OpenRouterService } from '../../../services/OpenRouterService';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';
import { UsageInfo } from '../../../core/streaming/types';
import { IncompleteToolCall } from '../../../core/streaming/types';
import { SessionType } from '../../../services/HistoryManager';
import { TokenBudgetManager } from './TokenBudgetManager';
import { ConversationRepairResult } from '../toolcall';
import { buildTruncatedRetryPrompt } from '../toolcall/ToolRetryPrompts';

const log = new LogService('ChatFlowManager');

export class ChatFlowManager {
    private readonly tokenBudgetManager = new TokenBudgetManager();
    private readonly proactiveCompressionThreshold = 0.8;
    private readonly aggressiveCompressionThreshold = 0.95;
    private readonly compressionLogThrottleMs = 30_000;
    private readonly lastCompressionLogAt = new Map<string, number>();
    private readonly sequenceRetryMaxAttempts = 3;
    private readonly sequenceBackoffBaseMs = 2000;
    private readonly sequenceRepairHistoryLimit = 10;
    private readonly toolOutputPruneProtectTokens = 40_000;
    private readonly toolOutputPruneProtectedTurns = 2;
    private readonly modelWarningByFlow = new Set<string>();
    private readonly knownSequenceIssueModels = new Set<string>([
        'minimax/minimax-m2.7',
        'minimax/minimax-m1',
        'minimax/minimax-01'
    ]);

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
        const baseTemperature = mode?.temperature ?? 0.7;
        const sampling = this.getSamplingOverrides(context.selectedModel, baseTemperature);
        const modelMaxOutputStart = Date.now();
        const modelMaxOutput = await this.openRouterService.getMaxTokens(context.selectedModel);
        this.logPerf('getMaxTokens', Date.now() - modelMaxOutputStart, context, { model: context.selectedModel });
        const modelContextLengthStart = Date.now();
        const modelContextLength = await this.openRouterService.getContextLength(context.selectedModel);
        this.logPerf('getContextLength', Date.now() - modelContextLengthStart, context, { model: context.selectedModel });

        this.sendMessageToWebview({ type: 'activityUpdate', label: 'Preparing prompt...' });
        context.promptVariantOverride = this.resolveAdaptivePromptVariant(context, modelContextLength);
        const systemPrompt = await this.promptManager.prepareSystemPrompt(context, retryCount);
        const strictSequenceMode = this.isKnownSequenceIssueModel(context.selectedModel);
        if (strictSequenceMode) {
            const flowKey = context.currentFlowId || `${context.selectedModel}:${Date.now()}`;
            if (!this.modelWarningByFlow.has(flowKey)) {
                this.modelWarningByFlow.add(flowKey);
                this.sendMessageToWebview({
                    type: 'info',
                    message: `Model ${context.selectedModel} is running with stricter tool-sequence validation due to known provider quirks.`
                });
            }
        }
        const initialPreflight = this.repairConversationSequence(context, context.selectedModel, 'preflight_initial', strictSequenceMode);
        const repairWarnings: string[] = [];
        if (initialPreflight.repaired && initialPreflight.fixes.length > 0) {
            repairWarnings.push(...initialPreflight.fixes);
        }

        let rawMessages: ChatMessage[] = [
            { role: 'system' as const, content: systemPrompt },
            ...context.conversationHistory.map(toChatMessage),
        ];

        const tools = this.getToolsForMode(context);
        const responseFormat = tools && context.selectedModel === 'deepseek/deepseek-chat' ? { type: 'json_object' as const } : undefined;
        const configuredMaxTokens = this.getConfiguredMaxTokens();
        const estimatedInputTokens = this.tokenBudgetManager.estimateInputTokens(rawMessages, tools);
        const utilization = modelContextLength > 0 ? estimatedInputTokens / modelContextLength : 0;
        let compressionLevel: 'none' | 'proactive' | 'aggressive' = 'none';
        if (utilization >= this.aggressiveCompressionThreshold) {
            compressionLevel = 'aggressive';
        } else if (utilization >= this.proactiveCompressionThreshold) {
            compressionLevel = 'proactive';
        }

        const compressionWarnings: string[] = [];
        if (compressionLevel === 'aggressive') {
            const warning = `Context fast voll (${(utilization * 100).toFixed(1)}%). Aggressive Komprimierung aktiv.`;
            compressionWarnings.push(warning);
            this.sendMessageToWebview({ type: 'info', message: warning });
            this.logCompressionEvent(
                'aggressive_compression_triggered',
                `model=${context.selectedModel} inputTokens=${estimatedInputTokens} contextLimit=${modelContextLength} utilization=${(utilization * 100).toFixed(1)}%`,
                false,
                context.currentFlowId || context.selectedModel
            );
        } else if (compressionLevel === 'proactive') {
            const warning = `Context zu ${(utilization * 100).toFixed(1)}% gefuellt. Aeltere Nachrichten werden komprimiert.`;
            compressionWarnings.push(warning);
            this.sendMessageToWebview({ type: 'info', message: warning });
            this.logCompressionEvent(
                'proactive_compression_triggered',
                `model=${context.selectedModel} inputTokens=${estimatedInputTokens} contextLimit=${modelContextLength} utilization=${(utilization * 100).toFixed(1)}%`,
                true,
                context.currentFlowId || context.selectedModel
            );
        }

        let inputBudget = this.computeInputBudgetTokens(modelContextLength, compressionLevel);
        let compression = this.tokenBudgetManager.compressMessagesForBudget(
            context.selectedModel,
            rawMessages,
            tools,
            inputBudget
        );
        if (compression.wasCompressed) {
            this.logCompressionEvent(
                'context_compressed_before_request',
                `model=${context.selectedModel} dropped=${compression.droppedMessages} inputTokens=${compression.inputTokens} budget=${inputBudget} level=${compressionLevel} summaryInserted=${compression.summaryInserted}`,
                true,
                context.currentFlowId || context.selectedModel
            );
        }

        if (compression.inputTokens > modelContextLength && compressionLevel !== 'aggressive') {
            compressionLevel = 'aggressive';
            inputBudget = this.computeInputBudgetTokens(modelContextLength, compressionLevel);
            compression = this.tokenBudgetManager.compressMessagesForBudget(
                context.selectedModel,
                rawMessages,
                tools,
                inputBudget
            );
            this.logCompressionEvent(
                'aggressive_compression_retry',
                `model=${context.selectedModel} dropped=${compression.droppedMessages} inputTokens=${compression.inputTokens} budget=${inputBudget}`,
                false,
                context.currentFlowId || context.selectedModel
            );
        }

        if (compression.inputTokens > modelContextLength) {
            const overflowRescue = this.tokenBudgetManager.pruneToolOutputsForContext(
                context.selectedModel,
                rawMessages,
                tools,
                inputBudget,
                {
                    protectTokens: this.toolOutputPruneProtectTokens,
                    protectedTurns: this.toolOutputPruneProtectedTurns
                }
            );

            if (overflowRescue.prunedMessages > 0) {
                rawMessages = overflowRescue.messages;
                context.conversationHistory = rawMessages.slice(1).map((chatMessage, index) =>
                    fromChatMessage(chatMessage, context.conversationHistory[index]?.id)
                );
                compression = this.tokenBudgetManager.compressMessagesForBudget(
                    context.selectedModel,
                    rawMessages,
                    tools,
                    inputBudget
                );
                this.sendMessageToWebview({
                    type: 'info',
                    message: `Context overflow rescued by pruning ${overflowRescue.prunedMessages} older tool outputs.`
                });
            }
        }

        if (compression.inputTokens > modelContextLength) {
            const warning = `Context weiterhin ueber Limit (${compression.inputTokens}/${modelContextLength}) nach Komprimierung.`;
            compressionWarnings.push(warning);
            this.logCompressionEvent(
                'context_over_limit_after_compression',
                `model=${context.selectedModel} inputTokens=${compression.inputTokens} contextLimit=${modelContextLength} level=${compressionLevel}`,
                false,
                context.currentFlowId || context.selectedModel
            );
            this.sendMessageToWebview({
                type: 'error',
                message: 'Kontext ist zu gross und konnte trotz Komprimierung nicht sicher reduziert werden. Bitte starte einen neuen Chat oder kuerze den Verlauf.'
            });
            this.sendMessageToWebview({ type: 'activityUpdate', label: null });
            this.sendMessageToWebview({ type: 'processingEnd' });
            this.sendMessageToWebview({ type: 'generatingEnd' });
            return;
        }
        let messages = compression.messages;

        let maxTokens = this.computeMaxOutputTokens(compression.inputTokens, modelContextLength, modelMaxOutput, configuredMaxTokens);

        // Always send generatingStart to ensure the UI indicator is active,
        // even for follow-up responses (e.g. after tool execution)
        this.sendMessageToWebview({ type: 'generatingStart' });

        context.shouldStopStream = false;
        let rateLimitRetryCount = 0;
        let contextLengthRetried = false;
        let sequenceRetryCount = 0;
        let assistantMessage = '';
        let toolCalls: any[] = [];
        let incompleteToolCalls: IncompleteToolCall[] = [];
        let usage: UsageInfo | undefined;
        while (true) {
            try {
                const result = await this.streamingService.streamResponse(messages, {
                    temperature: sampling.temperature,
                    topK: sampling.topK,
                    maxTokens,
                    model: context.selectedModel,
                    tools,
                    responseFormat,
                    isFollowUp,
                    shouldStopRef: { get current() { return context.shouldStopStream; } } as any
                });
                assistantMessage = result.assistantMessage;
                toolCalls = result.toolCalls;
                incompleteToolCalls = result.incompleteToolCalls || [];
                usage = result.usage;
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
                    this.openRouterService.isToolCallSequenceError(error) &&
                    !context.shouldStopStream &&
                    sequenceRetryCount < this.sequenceRetryMaxAttempts
                ) {
                    const retryAttempt = sequenceRetryCount + 1;
                    const retryDelayMs = this.sequenceBackoffBaseMs * Math.pow(2, retryAttempt - 1);
                    const repairResult = this.repairConversationSequence(context, context.selectedModel, `retry_attempt_${retryAttempt}`, true);

                    if (repairResult.fixes.length > 0) {
                        repairWarnings.push(...repairResult.fixes);
                    }

                    this.sendMessageToWebview({
                        type: 'retryStatus',
                        attempt: retryAttempt,
                        maxAttempts: this.sequenceRetryMaxAttempts,
                        delayMs: retryDelayMs,
                        reason: 'tool_call_sequence',
                        model: context.selectedModel,
                        fixes: repairResult.fixes
                    } as any);
                    this.sendMessageToWebview({
                        type: 'activityUpdate',
                        label: `Repairing conversation... (${retryAttempt}/${this.sequenceRetryMaxAttempts})`
                    });

                    const repeatedPattern = this.trackSequenceRepairPattern(context, repairResult.repairHash);
                    if (repeatedPattern) {
                        this.sendMessageToWebview({
                            type: 'info',
                            message: `Repeated sequence issues detected for ${context.selectedModel}. Consider switching model if this continues.`
                        });
                        log.warn(`repeated_sequence_pattern_detected: model=${context.selectedModel} hash=${repairResult.repairHash || 'none'} attempt=${retryAttempt}`);
                    }

                    await this.sleepWithStop(retryDelayMs, context);
                    if (context.shouldStopStream) {
                        throw new Error('Request stopped by user.');
                    }

                    rawMessages = [
                        { role: 'system' as const, content: systemPrompt },
                        ...context.conversationHistory.map(toChatMessage),
                    ];
                    compression = this.tokenBudgetManager.compressMessagesForBudget(
                        context.selectedModel,
                        rawMessages,
                        tools,
                        inputBudget
                    );
                    messages = compression.messages;
                    maxTokens = this.computeMaxOutputTokens(compression.inputTokens, modelContextLength, modelMaxOutput, configuredMaxTokens);
                    sequenceRetryCount += 1;
                    continue;
                }
                if (this.openRouterService.isToolCallSequenceError(error)) {
                    throw new Error('Tool-call sequence could not be repaired automatically. Please retry or start a new conversation.');
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
            await this.completeStreaming(
                context,
                assistantMessage,
                toolCalls,
                incompleteToolCalls,
                usage,
                modelContextLength,
                compression.inputTokens,
                compressionLevel,
                [...compressionWarnings, ...repairWarnings],
                isFollowUp
            );
            this.sendMessageToWebview({ type: 'generatingEnd' });
        }
        
        // Ensure activity label is cleared after LLM completes (regardless of content)
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });
    }

    private async completeStreaming(
        context: ChatViewContext,
        assistantMessage: string,
        toolCalls: any[],
        incompleteToolCalls: IncompleteToolCall[],
        usage: UsageInfo | undefined,
        modelContextLength: number,
        currentContextTokens: number,
        compressionLevel: 'none' | 'proactive' | 'aggressive',
        warnings: string[],
        isFollowUp: boolean
    ): Promise<void> {
        const messageId = `msg-${Date.now()}`;
        const assistantMsg: Message = { id: messageId, timestamp: Date.now(), role: 'assistant', content: assistantMessage, tool_calls: toolCalls.length > 0 ? toolCalls : undefined };

        context.conversationHistory.push(assistantMsg);
        this.sendMessageToWebview({ type: 'assistantMessageEnd', messageId });
        this.sendMessageToWebview({ type: 'generatingEnd' });
        
        await this.sessionHistoryManager.saveMessageToHistory(assistantMsg);
        await this.updateActiveSessionTokenUsage(context, usage, modelContextLength, currentContextTokens, compressionLevel, warnings);

        // Clear activity label after saving to history
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });

        if (toolCalls.length > 0) {
            await this.toolCallDispatcher.handleToolCalls(toolCalls, messageId, context);
            return;
        }

        if (incompleteToolCalls.length > 0) {
            const retryPrompt = this.buildTruncationFollowUpPrompt(incompleteToolCalls[0]);
            const retryMsg: Message = {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                timestamp: Date.now(),
                role: 'user',
                content: retryPrompt
            };
            context.conversationHistory.push(retryMsg);
            this.sendMessageToWebview({
                type: 'info',
                message: `Detected ${incompleteToolCalls.length} truncated tool call(s). Asking model to retry with smaller chunks.`
            });
            await this.generateAndStreamResponse(context, retryPrompt, 0, true);
        }
    }

    private resolveAdaptivePromptVariant(context: ChatViewContext, modelContextLength: number): 'minimal' | undefined {
        const config = vscode.workspace.getConfiguration('gently');
        const adaptiveEnabled = config.get<boolean>('performance.adaptivePromptVariant', true);
        if (!adaptiveEnabled || modelContextLength <= 0) return undefined;

        const usageThreshold = this.sanitizePositiveInt(config.get<number>('performance.adaptiveVariantUsageThresholdPercent', 75), 75);
        const noToolTurns = this.sanitizePositiveInt(config.get<number>('performance.adaptiveVariantNoToolTurns', 3), 3);
        const minConversationLength = this.sanitizePositiveInt(config.get<number>('performance.adaptiveVariantMinConversationLength', 20), 20);

        const approxUsedTokens = Math.ceil(
            context.conversationHistory.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4
        );
        const usagePercent = (approxUsedTokens / modelContextLength) * 100;
        const recentMessages = context.conversationHistory.slice(-Math.max(1, noToolTurns * 2));
        const recentToolCalls = recentMessages.reduce((sum, msg) => {
            if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) return sum;
            return sum + msg.tool_calls.length;
        }, 0);
        const conversationLength = context.conversationHistory.length;

        const useMinimal = usagePercent > usageThreshold || (recentToolCalls === 0 && conversationLength > minConversationLength);
        this.logPerf('adaptivePromptVariantDecision', 0, context, {
            usage_percent: Number(usagePercent.toFixed(2)),
            usage_threshold_percent: usageThreshold,
            recent_tool_calls: recentToolCalls,
            recent_turn_window: noToolTurns,
            conversation_length: conversationLength,
            min_conversation_length: minConversationLength,
            variant: useMinimal ? 'minimal' : 'configured'
        });
        return useMinimal ? 'minimal' : undefined;
    }

    private sanitizePositiveInt(value: number | undefined, fallback: number): number {
        if (!Number.isFinite(value)) return fallback;
        const normalized = Math.floor(Number(value));
        return normalized > 0 ? normalized : fallback;
    }

    private logPerf(phase: string, durationMs: number, context: ChatViewContext, extra: Record<string, unknown> = {}): void {
        log.info(JSON.stringify({
            'perf.phase': phase,
            duration_ms: durationMs,
            flow_id: context.currentFlowId || null,
            model: context.selectedModel || null,
            workspace: vscode.workspace.name || 'No workspace open',
            ...extra
        }));
    }

    private buildTruncationFollowUpPrompt(incomplete: IncompleteToolCall): string {
        const recoveredPath = typeof incomplete.recoveredFields?.path === 'string'
            ? String(incomplete.recoveredFields.path)
            : typeof incomplete.recoveredFields?.file_path === 'string'
                ? String(incomplete.recoveredFields.file_path)
                : undefined;
        const recoveredContent = typeof incomplete.recoveredFields?.content === 'string'
            ? String(incomplete.recoveredFields.content)
            : typeof incomplete.recoveredFields?.new_content === 'string'
                ? String(incomplete.recoveredFields.new_content)
                : '';
        return buildTruncatedRetryPrompt({
            toolName: incomplete.name || 'unknown_tool',
            recoveredPath,
            contentPreview: recoveredContent || incomplete.rawArgumentsPreview,
            totalChars: incomplete.charCount
        });
    }

    private async updateActiveSessionTokenUsage(
        context: ChatViewContext,
        usage: UsageInfo | undefined,
        modelContextLength: number,
        currentContextTokens: number,
        compressionLevel: 'none' | 'proactive' | 'aggressive',
        warnings: string[]
    ): Promise<void> {
        const activeSession = await this.sessionHistoryManager.getActiveSession(SessionType.CHAT);
        if (!activeSession) return;

        const existing = this.getTokenUsageFromMetadata(activeSession.metadata?.tokenUsage);
        const incoming = this.getIncomingUsage(usage);
        const merged = {
            promptTokens: existing.promptTokens + incoming.promptTokens,
            completionTokens: existing.completionTokens + incoming.completionTokens,
            totalTokens: existing.totalTokens + incoming.totalTokens,
            cacheReadInputTokens: existing.cacheReadInputTokens + incoming.cacheReadInputTokens,
            cacheWriteInputTokens: existing.cacheWriteInputTokens + incoming.cacheWriteInputTokens,
            currentContextTokens: Number(currentContextTokens || 0),
            modelContextLength: Number(modelContextLength || 0),
            compressionLevel,
            warnings,
            estimatedCostUsd: null as number | null,
            lastUpdated: Date.now()
        };

        const pricing = context.selectedModel ? await this.openRouterService.getModelPricing(context.selectedModel) : null;
        merged.estimatedCostUsd = this.calculateEstimatedCost(merged, pricing);

        const metadata = {
            ...(activeSession.metadata || {}),
            tokenUsage: merged
        };

        const chatProvider = this.sessionHistoryManager.getChatProvider();
        if (chatProvider) {
            await chatProvider.updateSession(activeSession.id, { metadata });
        }

        this.sendMessageToWebview({
            type: 'tokenTrackerUpdate',
            usage: merged,
            currentContextTokens: merged.currentContextTokens,
            modelContextLength: merged.modelContextLength,
            sessionPromptTokens: merged.promptTokens,
            sessionCompletionTokens: merged.completionTokens,
            sessionTotalTokens: merged.totalTokens,
            compressionLevel: merged.compressionLevel,
            warnings: merged.warnings,
            maxTokens: modelContextLength,
            pricing,
            cost: merged.estimatedCostUsd
        } as any);
    }

    private getIncomingUsage(usage: UsageInfo | undefined) {
        return {
            promptTokens: usage?.prompt_tokens || 0,
            completionTokens: usage?.completion_tokens || 0,
            totalTokens: usage?.total_tokens || 0,
            cacheReadInputTokens: usage?.cache_read_input_tokens || 0,
            cacheWriteInputTokens: usage?.cache_write_input_tokens || 0
        };
    }

    private getTokenUsageFromMetadata(value: any) {
        return {
            promptTokens: Number(value?.promptTokens || 0),
            completionTokens: Number(value?.completionTokens || 0),
            totalTokens: Number(value?.totalTokens || 0),
            cacheReadInputTokens: Number(value?.cacheReadInputTokens || 0),
            cacheWriteInputTokens: Number(value?.cacheWriteInputTokens || 0),
            currentContextTokens: Number(value?.currentContextTokens || 0),
            modelContextLength: Number(value?.modelContextLength || 0),
            compressionLevel: value?.compressionLevel === 'aggressive'
                ? 'aggressive'
                : value?.compressionLevel === 'proactive'
                    ? 'proactive'
                    : 'none' as 'none' | 'proactive' | 'aggressive',
            warnings: Array.isArray(value?.warnings)
                ? value.warnings.filter((item: unknown) => typeof item === 'string')
                : [] as string[],
            estimatedCostUsd: value?.estimatedCostUsd == null ? null : Number(value.estimatedCostUsd),
            lastUpdated: Number(value?.lastUpdated || 0)
        };
    }

    private calculateEstimatedCost(
        usage: {
            promptTokens: number;
            completionTokens: number;
            cacheReadInputTokens: number;
            cacheWriteInputTokens: number;
        },
        pricing: ModelPricing | null
    ): number | null {
        if (!pricing) return null;

        const promptPrice = pricing.prompt ?? 0;
        const completionPrice = pricing.completion ?? 0;
        const cacheReadPrice = pricing.cache_read ?? 0;
        const cacheWritePrice = pricing.cache_write ?? 0;
        const hasAnyPrice = [promptPrice, completionPrice, cacheReadPrice, cacheWritePrice].some((v) => v > 0);
        if (!hasAnyPrice) return null;

        return (
            (promptPrice / 1_000_000) * usage.promptTokens +
            (completionPrice / 1_000_000) * usage.completionTokens +
            (cacheReadPrice / 1_000_000) * usage.cacheReadInputTokens +
            (cacheWritePrice / 1_000_000) * usage.cacheWriteInputTokens
        );
    }

    private validateHistory(context: ChatViewContext): void {
        const chatMessages = context.conversationHistory.map(toChatMessage);
        const validation = this.toolCallManager.validateConversationHistory(chatMessages);
        if (!validation.valid) {
            const repair = this.toolCallManager.repairConversationHistory(chatMessages);
            if (repair.repaired) {
                context.conversationHistory = repair.messages.map((message, index) =>
                    fromChatMessage(message, context.conversationHistory[index]?.id)
                );
            }
        }
    }

    private repairConversationSequence(
        context: ChatViewContext,
        modelId: string,
        stage: string,
        verbose: boolean
    ): ConversationRepairResult {
        const chatMessages = context.conversationHistory.map(toChatMessage);
        const repair = this.toolCallManager.repairConversationHistory(chatMessages);
        if (repair.repaired) {
            context.conversationHistory = repair.messages.map((message, index) =>
                fromChatMessage(message, context.conversationHistory[index]?.id)
            );
        }
        const shouldLogVerbose = verbose || this.isKnownSequenceIssueModel(modelId);
        if (shouldLogVerbose) {
            log.info(`[model=${modelId}] sequence_preflight_${stage}: repaired=${repair.repaired} issuesBefore=${repair.issuesBefore.join(',')} issuesAfter=${repair.issuesAfter.join(',')} fixes=${repair.fixes.join(';')}`);
        }
        return repair;
    }

    private trackSequenceRepairPattern(context: ChatViewContext, repairHash?: string): boolean {
        if (!repairHash) return false;
        const history = Array.isArray(context.sequenceRepairHistory) ? context.sequenceRepairHistory : [];
        history.push(repairHash);
        while (history.length > this.sequenceRepairHistoryLimit) history.shift();
        context.sequenceRepairHistory = history;
        if (history.length < 3) return false;
        const lastThree = history.slice(-3);
        return lastThree.every((hash) => hash === repairHash);
    }

    private isKnownSequenceIssueModel(modelId: string | null): boolean {
        if (!modelId) return false;
        return this.knownSequenceIssueModels.has(modelId.toLowerCase());
    }

    private getToolsForMode(context: ChatViewContext): any[] | undefined {
        const mode = this.modeService.getCurrentMode();
        if (!mode) return this.agentManager.getFormattedTools();

        const tools = mode.getToolsForMode(this.agentManager);
        log.info(`getToolsForMode: mode=${mode.id}, returning ${tools?.length || 0} tools`);
        return tools;
    }

    private getSamplingOverrides(modelId: string, baseTemperature: number): { temperature: number; topK?: number } {
        const normalized = modelId.toLowerCase();
        if (normalized.includes('minimax-m2')) {
            return { temperature: 1.0, topK: 40 };
        }
        if (normalized.includes('minimax-m1')) {
            return { temperature: baseTemperature, topK: 20 };
        }
        return { temperature: baseTemperature };
    }

    private getConfiguredMaxTokens(): number {
        const configured = vscode.workspace.getConfiguration('gently').get<number>('maxTokens');
        if (typeof configured === 'number' && configured > 0) return configured;
        return Number.MAX_SAFE_INTEGER;
    }

    private computeInputBudgetTokens(
        modelContextLength: number,
        compressionLevel: 'none' | 'proactive' | 'aggressive'
    ): number {
        const baseReserve = compressionLevel === 'aggressive' ? 2048 : 1024;
        const minimumOutputReserve = compressionLevel === 'aggressive' ? 1024 : 256;
        return Math.max(1024, modelContextLength - baseReserve - minimumOutputReserve);
    }

    private computeMaxOutputTokens(
        inputTokens: number,
        modelContextLength: number,
        modelMaxOutput: number,
        userConfiguredMax: number
    ): number {
        const baseReserve = 1024;
        const safeMax = modelContextLength - inputTokens - baseReserve;
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

    private logCompressionEvent(event: string, details: string, throttled: boolean, scope?: string): void {
        const key = scope ? `${event}:${scope}` : event;
        const now = Date.now();
        if (throttled) {
            const previous = this.lastCompressionLogAt.get(key) || 0;
            if (now - previous < this.compressionLogThrottleMs) {
                return;
            }
            this.lastCompressionLogAt.set(key, now);
        }
        log.info(`${event}: ${details}`);
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

        this.tokenBudgetManager.dispose();
    }
}
