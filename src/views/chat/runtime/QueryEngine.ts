import * as vscode from 'vscode';
import { ChatViewContext, Message, toChatMessage, fromChatMessage } from '../types/ChatTypes';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { SessionHistoryManager } from '../handlers/SessionHistoryManager';
import { ReferenceParser, PromptManager, ConversationPruner } from '../handlers/ContextGenerators';
import { StreamingService } from '../handlers/StreamingService';
import { ToolCallManager } from '../toolcall';
import { ToolCallDispatcher } from '../handlers/ExecutionDispatchers';
import { LogService } from '../../../services/LogService';
import { ModeService } from '../../../modes/ModeService';
import { ChatMessage, ModelPricing, OpenRouterService } from '../../../services/OpenRouterService';
import {
    OutboundWebviewMessage,
    ResilienceStatusAction,
    ResilienceStatusCategory,
    ResilienceStatusCode,
    ResilienceStatusSeverity
} from '../types/WebviewMessageTypes';
import { UsageInfo } from '../../../core/streaming/types';
import { IncompleteToolCall } from '../../../core/streaming/types';
import { SessionType } from '../../../services/HistoryManager';
import { CompressionResult, TokenBudgetManager } from '../handlers/TokenBudgetManager';
import { ConversationRepairResult } from '../toolcall';
import { buildTruncatedRetryPrompt } from '../toolcall/ToolRetryPrompts';
import { getModelPolicyResult, getReasoningConfig, ReasoningConfig, ReasoningEffort } from '../../../utils/modelPolicy';
import { filterToolsForModeContract } from '../../../modes/ModeContractV2';
import { RetryPolicyEngine } from './RetryPolicyEngine';
import { StreamContractEngine, StreamContractViolationError } from './StreamContractEngine';
import { TurnEngine } from './TurnEngine';
import { sleepWithAbort } from '../../../core/resilience/RetryDelayUtils';
import { QueryRuntimeEvent, QueryRuntimeResult } from './QueryEngineContract';

const log = new LogService('QueryEngine');

export class EmptyAssistantResponseError extends Error {
    constructor(message: string = 'No assistant message was received.') {
        super(message);
        this.name = 'EmptyAssistantResponseError';
    }
}

interface RetryOrchestratorState {
    rateLimitRetries: number;
    sequenceRetries: number;
    emptyResponseRetries: number;
    contextRecoveryAttempts: number;
    attempt: number;
}

interface ContextRecoveryState {
    attemptedAggressiveRecompress: boolean;
    attemptedToolOutputPrune: boolean;
    maxTokenReductionAttempts: number;
}

interface ContextRecoveryResult {
    progressed: boolean;
    changed: boolean;
    reason: 'aggressive_recompress' | 'tool_output_prune' | 'max_tokens_reduce' | 'exhausted';
    rawMessages: ChatMessage[];
    compression: CompressionResult;
    messages: ChatMessage[];
    maxTokens: number;
    compressionLevel: 'none' | 'proactive' | 'aggressive';
    inputBudget: number;
    signature: string;
}

type ResilienceTelemetryCode = ResilienceStatusCode | 'REQUEST_ATTEMPT';

export class QueryEngine {
    private readonly tokenBudgetManager = new TokenBudgetManager();
    private readonly retryPolicyEngine = new RetryPolicyEngine();
    private readonly retryBudgets = this.retryPolicyEngine.getBudgets();
    private readonly streamContractEngine = new StreamContractEngine();
    private readonly proactiveCompressionThreshold = 0.8;
    private readonly aggressiveCompressionThreshold = 0.95;
    private readonly compressionLogThrottleMs = 30_000;
    private readonly lastCompressionLogAt = new Map<string, number>();
    private readonly sequenceRepairHistoryLimit = 10;
    private readonly toolOutputPruneProtectTokens = 40_000;
    private readonly toolOutputPruneProtectedTurns = 2;
    private readonly minOutputTokenBudget = 256;
    private readonly outputSafetyReserveTokens = 1024;
    private readonly sequenceRetryMaxAttempts = this.retryBudgets.sequence;
    private readonly contextRecoveryMaxAttempts = this.retryBudgets.context;
    private readonly emptyResponseMaxRetries = this.retryBudgets.empty;
    private readonly rateLimitMaxRetries = this.retryBudgets.rate_limit;
    private readonly resumeNoProgressMaxAutoRetries = 1;
    private readonly modelWarningByFlow = new Set<string>();
    private readonly knownSequenceIssueModels = new Set<string>([
        'minimax/minimax-m2.7',
        'minimax/minimax-m1',
        'minimax/minimax-01'
    ]);
    private readonly recoveryNarrativeCodeMap: Record<'context' | 'sequence' | 'empty_response' | 'rate_limit', string> = {
        context: 'CTX_BUDGET_UNSAFE',
        sequence: 'SEQUENCE_REPAIR_RETRY',
        empty_response: 'EMPTY_RESPONSE_DETECTED',
        rate_limit: 'RATE_LIMIT_RETRY'
    };
    private readonly permissionDenials: string[] = [];
    private readonly terminalRuntimeEventByFlow = new Map<string, 'result_success' | 'result_error'>();
    private readonly terminalRuntimeEventOrder: string[] = [];
    private readonly maxTrackedTerminalFlows = 256;
    private readonly runIdByFlow = new Map<string, string>();

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
        private readonly handleGuardrailPrivacyError?: () => Promise<void>,
        private readonly onRuntimeEvent?: (event: QueryRuntimeEvent) => void
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
            if (context.currentRunId) {
                this.runIdByFlow.set(context.currentFlowId, context.currentRunId);
            }
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
        if (!context.currentFlowId) {
            context.currentFlowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        }
        if (context.currentRunId) {
            this.runIdByFlow.set(context.currentFlowId, context.currentRunId);
        }
        const isResumeRun = context.currentMessageSource === 'resume';
        const resumeProgressBefore = isResumeRun ? this.capturePlanProgressSnapshot() : null;
        const runtimeConfig = vscode.workspace.getConfiguration('gently');
        const maxTurns = this.sanitizePositiveInt(runtimeConfig.get<number>('queryRuntime.maxTurns', 24), 24);
        const maxStructuredOutputRetries = this.sanitizePositiveInt(
            runtimeConfig.get<number>('queryRuntime.maxStructuredOutputRetries', 5),
            5
        );
        const maxBudgetUsdRaw = runtimeConfig.get<number>('queryRuntime.maxBudgetUsd');
        const maxBudgetUsd =
            typeof maxBudgetUsdRaw === 'number' && Number.isFinite(maxBudgetUsdRaw) && maxBudgetUsdRaw > 0
                ? maxBudgetUsdRaw
                : null;
        const turnId = `${context.currentFlowId}:turn:${Date.now()}`;
        if (isFollowUp && retryCount > maxStructuredOutputRetries) {
            const maxStructuredOutputError = this.createRuntimeResult({
                code: 'MAX_STRUCTURED_OUTPUT_RETRIES_EXCEEDED',
                category: 'runtime',
                retryable: false,
                attempt: retryCount,
                maxAttempts: maxStructuredOutputRetries,
                usage: undefined,
                cost: null,
                message: `Structured output retries exceeded (${maxStructuredOutputRetries}).`
            });
            this.emitRuntimeEvent({ type: 'result_error', flowId: context.currentFlowId, result: maxStructuredOutputError });
            throw new Error(maxStructuredOutputError.message ?? 'Structured output retries exceeded.');
        }
        await this.sessionHistoryManager.saveQueryRuntimeState({
            flowId: context.currentFlowId,
            turnId,
            phase: 'start'
        });
        this.emitRuntimeEvent({
            type: 'system_init',
            flowId: context.currentFlowId,
            model: context.selectedModel,
            maxTurns,
            maxBudgetUsd,
            maxStructuredOutputRetries
        });
        const strictResponseGuardsEnabled = true;
        const contextRecoveryV2Enabled = true;
        const turnEngine = new TurnEngine();
        const transitionTurn = (next: 'PREFLIGHT' | 'STREAMING' | 'TOOL_EXEC' | 'RECOVERY' | 'TERMINAL', reason: string) => {
            const from = turnEngine.getState();
            turnEngine.transition(next, reason);
            this.emitRuntimeEvent({
                type: 'turn_transition',
                flowId: context.currentFlowId || 'flow-unknown',
                from,
                to: next,
                reason
            });
        };
        const beginRecovery = (category: 'context' | 'sequence' | 'empty' | 'rate_limit', reason: string) => {
            const from = turnEngine.getState();
            turnEngine.beginRecovery(category, reason);
            this.emitRuntimeEvent({
                type: 'turn_transition',
                flowId: context.currentFlowId || 'flow-unknown',
                from,
                to: 'RECOVERY',
                reason: `${category}:${reason}`
            });
        };
        const endRecovery = (next: 'PREFLIGHT' | 'STREAMING', reason: string) => {
            turnEngine.endRecovery(next, reason);
            this.emitRuntimeEvent({
                type: 'turn_transition',
                flowId: context.currentFlowId || 'flow-unknown',
                from: 'RECOVERY',
                to: next,
                reason
            });
        };
        const terminalizeTurn = (outcome: 'completed' | 'failed' | 'stopped', reason: string) => {
            const from = turnEngine.getState();
            turnEngine.terminalize(outcome, reason);
            this.emitRuntimeEvent({
                type: 'turn_transition',
                flowId: context.currentFlowId || 'flow-unknown',
                from,
                to: 'TERMINAL',
                reason: `${outcome}:${reason}`
            });
        };
        transitionTurn('PREFLIGHT', 'initial_preflight');
        let runAbortController: AbortController | null = null;

        try {
        const baseTemperature = this.modeService.getTemperature();
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
        const messageIdentityMap = new Map<ChatMessage, string>();
        rawMessages.slice(1).forEach((chatMessage, index) => {
            const id = context.conversationHistory[index]?.id;
            if (id) messageIdentityMap.set(chatMessage, id);
        });

        const shouldPostponeCompression = context.isToolExecutionActive === true && estimatedInputTokens <= modelContextLength;
        let compression = shouldPostponeCompression
            ? {
                messages: rawMessages,
                inputTokens: estimatedInputTokens,
                droppedMessages: 0,
                wasCompressed: false,
                summaryInserted: false
            }
            : this.tokenBudgetManager.compressMessagesForBudget(
                context.selectedModel,
                rawMessages,
                tools,
                inputBudget
            );

        if (shouldPostponeCompression) {
            this.sendMessageToWebview({
                type: 'info',
                message: 'Compression postponed because tool execution is active.'
            });
        }
        if (compression.wasCompressed) {
            const committed = await this.commitCompressedHistory(
                context,
                compression.messages,
                messageIdentityMap,
                {
                    droppedCount: compression.droppedMessages,
                    summaryInserted: compression.summaryInserted,
                    source: 'budget'
                }
            );
            if (!committed) {
                compression = {
                    messages: rawMessages,
                    inputTokens: this.tokenBudgetManager.estimateInputTokens(rawMessages, tools),
                    droppedMessages: 0,
                    wasCompressed: false,
                    summaryInserted: false
                };
            } else {
                this.logCompressionEvent(
                'context_compressed_before_request',
                `model=${context.selectedModel} dropped=${compression.droppedMessages} inputTokens=${compression.inputTokens} budget=${inputBudget} level=${compressionLevel} summaryInserted=${compression.summaryInserted}`,
                true,
                context.currentFlowId || context.selectedModel
            );
            }
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
                const overflowCommitted = await this.commitCompressedHistory(
                    context,
                    rawMessages,
                    messageIdentityMap,
                    {
                        droppedCount: overflowRescue.prunedMessages,
                        summaryInserted: false,
                        source: 'overflow_rescue'
                    }
                );
                if (!overflowCommitted) {
                    rawMessages = [rawMessages[0], ...context.conversationHistory.map(toChatMessage)];
                }
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
            terminalizeTurn('failed', 'context_over_limit_after_compression');
            return;
        }
        let messages = compression.messages;

        let maxTokens = this.computeMaxOutputTokens(compression.inputTokens, modelContextLength, modelMaxOutput, configuredMaxTokens);
        const retryState: RetryOrchestratorState = {
            rateLimitRetries: 0,
            sequenceRetries: 0,
            emptyResponseRetries: 0,
            contextRecoveryAttempts: 0,
            attempt: 0
        };
        const contextRecoveryState: ContextRecoveryState = {
            attemptedAggressiveRecompress: false,
            attemptedToolOutputPrune: false,
            maxTokenReductionAttempts: 0
        };

        if (
            strictResponseGuardsEnabled &&
            contextRecoveryV2Enabled &&
            !this.hasSufficientOutputBudget(compression.inputTokens, modelContextLength, this.minOutputTokenBudget)
        ) {
            this.logResilienceEvent(
                'CTX_PREFLIGHT_BLOCK',
                `model=${context.selectedModel} inputTokens=${compression.inputTokens} contextLimit=${modelContextLength} maxTokens=${maxTokens}`
            );
            beginRecovery('context', 'preflight_context_recovery');
            while (
                retryState.contextRecoveryAttempts < this.contextRecoveryMaxAttempts &&
                !context.shouldStopStream &&
                !this.hasSufficientOutputBudget(compression.inputTokens, modelContextLength, this.minOutputTokenBudget)
            ) {
                const recovery = this.runContextRecoveryStep({
                    context,
                    systemPrompt,
                    tools,
                    modelContextLength,
                    modelMaxOutput,
                    configuredMaxTokens,
                    rawMessages,
                    compression,
                    messages,
                    maxTokens,
                    compressionLevel,
                    inputBudget,
                    state: contextRecoveryState
                });

                if (!recovery.progressed) break;
                retryState.contextRecoveryAttempts += 1;
                this.logResilienceEvent(
                    'CTX_RECOVERY_STEP',
                    `phase=preflight step=${recovery.reason} changed=${recovery.changed} attempt=${retryState.contextRecoveryAttempts}/${this.contextRecoveryMaxAttempts} inputTokens=${recovery.compression.inputTokens} maxTokens=${recovery.maxTokens}`
                );
                if (recovery.changed) {
                    this.emitResilienceTelemetryEvent('RESILIENCE_RECOVERY_APPLIED',
                        context,
                        'CTX_BUDGET_UNSAFE',
                        {
                            phase: 'preflight',
                            step: recovery.reason,
                            attempt: retryState.contextRecoveryAttempts,
                            maxAttempts: this.contextRecoveryMaxAttempts,
                            inputTokens: recovery.compression.inputTokens,
                            maxTokens: recovery.maxTokens
                        }
                    );
                }

                if (!recovery.changed) {
                    continue;
                }

                rawMessages = recovery.rawMessages;
                compression = recovery.compression;
                messages = recovery.messages;
                maxTokens = recovery.maxTokens;
                compressionLevel = recovery.compressionLevel;
                inputBudget = recovery.inputBudget;
            }
            endRecovery('PREFLIGHT', 'preflight_context_recovery_end');

            if (!this.hasSufficientOutputBudget(compression.inputTokens, modelContextLength, this.minOutputTokenBudget)) {
                this.emitResilienceStatus(context,
                    {
                        code: 'CTX_BUDGET_UNSAFE',
                        category: 'context',
                        severity: 'error',
                        retryable: false,
                        attempt: retryState.contextRecoveryAttempts,
                        maxAttempts: this.contextRecoveryMaxAttempts,
                        userMessage: 'Kontext-Budget reicht aktuell nicht fuer eine sichere Antwort. Bitte Verlauf kuerzen oder neuen Chat starten.',
                        action: 'new_chat'
                    }
                );
                this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                    context,
                    'CTX_BUDGET_UNSAFE',
                    {
                        phase: 'preflight',
                        attempt: retryState.contextRecoveryAttempts,
                        maxAttempts: this.contextRecoveryMaxAttempts,
                        inputTokens: compression.inputTokens,
                        modelContextLength
                    }
                );
                this.sendMessageToWebview({
                    type: 'error',
                    message: 'Kontext-Budget reicht aktuell nicht fuer eine sichere Antwort. Bitte Verlauf kuerzen oder neuen Chat starten.',
                    code: 'CTX_BUDGET_UNSAFE',
                    action: 'new_chat'
                });
                this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                this.sendMessageToWebview({ type: 'processingEnd' });
                this.sendMessageToWebview({ type: 'generatingEnd' });
                terminalizeTurn('failed', 'preflight_ctx_budget_unsafe');
                return;
            }
        }

        // Always send generatingStart to ensure the UI indicator is active,
        // even for follow-up responses (e.g. after tool execution)
        this.sendMessageToWebview({ type: 'generatingStart' });
        transitionTurn('STREAMING', 'stream_loop_start');

        runAbortController = new AbortController();
        context.activeRunAbortController = runAbortController;
        context.shouldStopStream = false;
        context.shouldAbortTools = false;
        let assistantMessage = '';
        let toolCalls: any[] = [];
        let incompleteToolCalls: IncompleteToolCall[] = [];
        let usage: UsageInfo | undefined;
        const pricing = context.selectedModel ? await this.openRouterService.getModelPricing(context.selectedModel) : null;
        let totalCostUsd = 0;
        let recoveryHint: { category: 'context' | 'sequence' | 'empty_response' | 'rate_limit'; reason: string; attempt: number; maxAttempts: number } | null = null;
        while (true) {
            if (context.shouldStopStream) {
                this.emitResilienceStatus(context,
                    {
                        code: 'REQUEST_STOPPED',
                        category: 'request',
                        severity: 'info',
                        retryable: false,
                        attempt: retryState.attempt,
                        maxAttempts: retryState.attempt,
                        userMessage: 'Request stopped.',
                        action: 'none'
                    }
                );
                this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                    context,
                    'REQUEST_STOPPED',
                    { attempt: retryState.attempt, maxTokens }
                );
                this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                this.sendMessageToWebview({ type: 'processingEnd' });
                this.sendMessageToWebview({ type: 'generatingEnd' });
                terminalizeTurn('stopped', 'stopped_before_attempt');
                return;
            }
            retryState.attempt += 1;
            if (retryState.attempt > maxTurns) {
                const result = this.createRuntimeResult({
                    code: 'MAX_TURNS_EXCEEDED',
                    category: 'runtime',
                    retryable: false,
                    attempt: retryState.attempt,
                    maxAttempts: maxTurns,
                    usage,
                    cost: totalCostUsd || null,
                    message: `Maximum turns exceeded (${maxTurns}).`
                });
                await this.sessionHistoryManager.saveQueryRuntimeState({
                    flowId: context.currentFlowId,
                    turnId,
                    phase: 'terminal',
                    resultCode: result.code,
                    attempt: result.attempt,
                    maxAttempts: result.maxAttempts
                });
                this.emitRuntimeEvent({ type: 'result_error', flowId: context.currentFlowId, result });
                throw new Error(result.message ?? 'Maximum turns exceeded.');
            }
            this.emitRuntimeEvent({
                type: 'query_attempt',
                flowId: context.currentFlowId,
                attempt: retryState.attempt,
                maxAttempts: maxTurns
            });
            await this.sessionHistoryManager.saveQueryRuntimeState({
                flowId: context.currentFlowId,
                turnId,
                phase: 'attempt',
                attempt: retryState.attempt,
                maxAttempts: maxTurns
            });
            this.emitResilienceTelemetryEvent('RESILIENCE_ATTEMPT_START',
                context,
                'REQUEST_ATTEMPT',
                {
                    attempt: retryState.attempt,
                    model: context.selectedModel,
                    maxTokens
                }
            );
            try {
                const requestMessages = this.applyRecoveryNarrativeHint(messages, recoveryHint);
                const result = await this.streamingService.streamResponse(requestMessages, {
                    temperature: sampling.temperature,
                    topP: sampling.topP,
                    topK: sampling.topK,
                    reasoningConfig: sampling.reasoningConfig,
                    maxTokens,
                    model: context.selectedModel,
                    tools,
                    responseFormat,
                    isFollowUp,
                    shouldStopRef: { get current() { return context.shouldStopStream; } } as any,
                    abortSignal: runAbortController?.signal
                });
                assistantMessage = result.assistantMessage;
                toolCalls = result.toolCalls;
                incompleteToolCalls = result.incompleteToolCalls || [];
                usage = result.usage;
                const usageForCost = this.getIncomingUsage(usage);
                const turnCost = this.calculateEstimatedCost(usageForCost, pricing);
                if (turnCost != null) {
                    totalCostUsd += turnCost;
                    if (maxBudgetUsd != null && totalCostUsd >= maxBudgetUsd) {
                        const budgetResult = this.createRuntimeResult({
                            code: 'MAX_BUDGET_EXCEEDED',
                            category: 'runtime',
                            retryable: false,
                            attempt: retryState.attempt,
                            maxAttempts: maxTurns,
                            usage,
                            cost: totalCostUsd,
                            message: `Maximum budget exceeded (${maxBudgetUsd.toFixed(2)} USD).`
                        });
                        await this.sessionHistoryManager.saveQueryRuntimeState({
                            flowId: context.currentFlowId,
                            turnId,
                            phase: 'terminal',
                            resultCode: budgetResult.code,
                            attempt: budgetResult.attempt,
                            maxAttempts: budgetResult.maxAttempts
                        });
                        this.emitRuntimeEvent({ type: 'result_error', flowId: context.currentFlowId, result: budgetResult });
                        throw new Error(budgetResult.message ?? 'Maximum budget exceeded.');
                    }
                }
                const streamContractInput = {
                    streamTerminated: result.streamTerminated,
                    stoppedByUser: context.shouldStopStream,
                    assistantMessage,
                    toolCalls,
                    incompleteToolCalls
                };
                recoveryHint = null;
                if (context.shouldStopStream) {
                    this.emitResilienceStatus(context,
                        {
                            code: 'REQUEST_STOPPED',
                            category: 'request',
                            severity: 'info',
                            retryable: false,
                            attempt: retryState.attempt,
                            maxAttempts: retryState.attempt,
                            userMessage: 'Request stopped.',
                            action: 'none'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                        context,
                        'REQUEST_STOPPED',
                        { attempt: retryState.attempt, maxTokens }
                    );
                    this.sendMessageToWebview({ type: 'processingEnd' });
                    this.sendMessageToWebview({ type: 'generatingEnd' });
                    this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                    terminalizeTurn('stopped', 'stopped_after_stream');
                    return;
                }

                if (strictResponseGuardsEnabled) {
                    this.streamContractEngine.assertTerminated(streamContractInput);
                    if (this.streamContractEngine.isStrictlyEmptyAssistantResponse(streamContractInput)) {
                        this.logResilienceEvent(
                            'EMPTY_RESPONSE_DETECTED',
                            `model=${context.selectedModel} retry=${retryState.emptyResponseRetries}/${this.emptyResponseMaxRetries}`
                        );
                        throw new EmptyAssistantResponseError();
                    }
                }
                this.emitRuntimeEvent({
                    type: 'tool_summary',
                    flowId: context.currentFlowId,
                    toolCalls: toolCalls.length,
                    incompleteToolCalls: incompleteToolCalls.length
                });
                break;
            } catch (error) {
                const isGuardrailPrivacyError = this.openRouterService.isGuardrailPrivacyError(error);
                const isStopRequested = context.shouldStopStream || this.isStoppedByUserError(error);
                const streamContractViolation =
                    strictResponseGuardsEnabled && error instanceof StreamContractViolationError
                        ? error
                        : null;
                const isMissingStreamStop = streamContractViolation?.code === 'STREAM_CONTRACT_MISSING_STOP';
                const isContextLengthError = this.openRouterService.isContextLengthError(error);
                const isSequenceError = this.openRouterService.isToolCallSequenceError(error, {
                    includeContextOverflowPattern: false
                });
                const isEmptyResponseError =
                    strictResponseGuardsEnabled &&
                    (error instanceof EmptyAssistantResponseError ||
                        streamContractViolation?.code === 'STREAM_CONTRACT_EMPTY_RESPONSE');
                const isRateLimitError = this.openRouterService.isRateLimitError(error);

                // Priority 1: guardrail/privacy block
                if (isGuardrailPrivacyError) {
                    log.error(`Guardrail privacy mismatch: status=404 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                    this.emitResilienceStatus(context,
                        {
                            code: 'GUARDRAIL_PRIVACY_BLOCK',
                            category: 'guardrail',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.attempt,
                            maxAttempts: retryState.attempt,
                            userMessage: 'OpenRouter blocked this request due to privacy/guardrail settings.',
                            action: 'check_privacy_settings'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'GUARDRAIL_PRIVACY_BLOCK',
                        { attempt: retryState.attempt, maxTokens }
                    );
                    if (this.handleGuardrailPrivacyError) {
                        await this.handleGuardrailPrivacyError();
                    }
                    throw new Error('OpenRouter blocked this request due to privacy/guardrail settings. To use free models, enable "free endpoints that may publish prompts" in https://openrouter.ai/settings/privacy');
                }

                // Priority 2: stop request
                if (isStopRequested) {
                    this.emitResilienceStatus(context,
                        {
                            code: 'REQUEST_STOPPED',
                            category: 'request',
                            severity: 'info',
                            retryable: false,
                            attempt: retryState.attempt,
                            maxAttempts: retryState.attempt,
                            userMessage: 'Request stopped.',
                            action: 'none'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                        context,
                        'REQUEST_STOPPED',
                        { attempt: retryState.attempt, maxTokens }
                    );
                    this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                    this.sendMessageToWebview({ type: 'processingEnd' });
                    this.sendMessageToWebview({ type: 'generatingEnd' });
                    terminalizeTurn('stopped', 'stopped_by_error');
                    return;
                }

                if (isMissingStreamStop) {
                    this.emitResilienceStatus(context,
                        {
                            code: 'STREAM_CONTRACT_MISSING_STOP',
                            category: 'request',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.attempt,
                            maxAttempts: retryState.attempt,
                            userMessage: 'Assistant stream ended unexpectedly. Please retry.',
                            action: 'retry'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'STREAM_CONTRACT_MISSING_STOP',
                        {
                            attempt: retryState.attempt,
                            maxTokens
                        }
                    );
                    this.sendMessageToWebview({
                        type: 'error',
                        message: 'Assistant stream ended unexpectedly without a terminal stop event. Please retry.',
                        code: 'STREAM_CONTRACT_MISSING_STOP',
                        action: 'retry'
                    });
                    throw new Error('Assistant stream ended unexpectedly without a terminal stop event.');
                }

                if (
                    isContextLengthError &&
                    contextRecoveryV2Enabled &&
                    !context.shouldStopStream
                ) {
                    beginRecovery('context', 'runtime_context_recovery');
                    let recovered = false;

                    while (
                        retryState.contextRecoveryAttempts < this.contextRecoveryMaxAttempts &&
                        !context.shouldStopStream
                    ) {
                        const recovery = this.runContextRecoveryStep({
                            context,
                            systemPrompt,
                            tools,
                            modelContextLength,
                            modelMaxOutput,
                            configuredMaxTokens,
                            rawMessages,
                            compression,
                            messages,
                            maxTokens,
                            compressionLevel,
                            inputBudget,
                            state: contextRecoveryState
                        });

                        if (!recovery.progressed) break;
                        retryState.contextRecoveryAttempts += 1;
                        this.logResilienceEvent(
                            'CTX_RECOVERY_STEP',
                            `phase=runtime step=${recovery.reason} changed=${recovery.changed} attempt=${retryState.contextRecoveryAttempts}/${this.contextRecoveryMaxAttempts} inputTokens=${recovery.compression.inputTokens} maxTokens=${recovery.maxTokens}`
                        );
                        if (recovery.changed) {
                            this.emitResilienceTelemetryEvent('RESILIENCE_RECOVERY_APPLIED',
                                context,
                                'CTX_BUDGET_UNSAFE',
                                {
                                    phase: 'runtime',
                                    step: recovery.reason,
                                    attempt: retryState.contextRecoveryAttempts,
                                    maxAttempts: this.contextRecoveryMaxAttempts,
                                    inputTokens: recovery.compression.inputTokens,
                                    maxTokens: recovery.maxTokens
                                }
                            );
                        }

                        if (!recovery.changed) {
                            continue;
                        }

                        rawMessages = recovery.rawMessages;
                        compression = recovery.compression;
                        messages = recovery.messages;
                        maxTokens = recovery.maxTokens;
                        compressionLevel = recovery.compressionLevel;
                        inputBudget = recovery.inputBudget;
                        recovered = true;
                        break;
                    }

                    if (recovered) {
                        endRecovery('STREAMING', 'runtime_context_recovered');
                        this.emitResilienceStatus(context,
                            {
                                code: 'CTX_BUDGET_UNSAFE',
                                category: 'context',
                                severity: 'warning',
                                retryable: true,
                                attempt: retryState.contextRecoveryAttempts,
                                maxAttempts: this.contextRecoveryMaxAttempts,
                                userMessage: 'Context was adjusted. Retrying with recovered budget.',
                                action: 'retry'
                            }
                        );
                        this.emitResilienceTelemetryEvent('RESILIENCE_RETRY_SCHEDULED',
                            context,
                            'CTX_BUDGET_UNSAFE',
                            {
                                attempt: retryState.contextRecoveryAttempts,
                                maxAttempts: this.contextRecoveryMaxAttempts,
                                nextDelayMs: 0
                            }
                        );
                        recoveryHint = {
                            category: 'context',
                            reason: 'runtime_context_recovery_applied',
                            attempt: retryState.contextRecoveryAttempts,
                            maxAttempts: this.contextRecoveryMaxAttempts
                        };
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        continue;
                    }

                    if (context.shouldStopStream) {
                        endRecovery('STREAMING', 'runtime_context_recovery_stopped');
                        this.emitResilienceStatus(context,
                            {
                                code: 'REQUEST_STOPPED',
                                category: 'request',
                                severity: 'info',
                                retryable: false,
                                attempt: retryState.attempt,
                                maxAttempts: retryState.attempt,
                                userMessage: 'Request stopped.',
                                action: 'none'
                            }
                        );
                        this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                            context,
                            'REQUEST_STOPPED',
                            { attempt: retryState.attempt, maxTokens }
                        );
                        this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                        this.sendMessageToWebview({ type: 'processingEnd' });
                        this.sendMessageToWebview({ type: 'generatingEnd' });
                        terminalizeTurn('stopped', 'stopped_during_context_recovery');
                        return;
                    }

                    endRecovery('STREAMING', 'runtime_context_recovery_exhausted');
                    this.emitResilienceStatus(context,
                        {
                            code: 'CTX_RECOVERY_EXHAUSTED',
                            category: 'context',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.contextRecoveryAttempts,
                            maxAttempts: this.contextRecoveryMaxAttempts,
                            userMessage: 'Context window exceeded and automatic recovery was exhausted. Please start a new chat or reduce history.',
                            action: 'new_chat'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'CTX_RECOVERY_EXHAUSTED',
                        {
                            attempt: retryState.contextRecoveryAttempts,
                            maxAttempts: this.contextRecoveryMaxAttempts,
                            maxTokens
                        }
                    );
                    throw new Error('Context window exceeded and automatic recovery was exhausted. Please start a new chat or reduce history.');
                }

                if (
                    isSequenceError &&
                    !context.shouldStopStream
                ) {
                    const tentativeAttempt = retryState.sequenceRetries + 1;
                    const repairResult = this.repairConversationSequence(context, context.selectedModel, `retry_attempt_${tentativeAttempt}`, true);
                    const repairProducedStateChange = repairResult.repaired || repairResult.fixes.length > 0;
                    const sequenceDecision = this.retryPolicyEngine.planRetry('sequence', {
                        attemptsUsed: retryState.sequenceRetries,
                        stateChanged: repairProducedStateChange
                    });

                    if (repairResult.fixes.length > 0) {
                        repairWarnings.push(...repairResult.fixes);
                    }
                    if (!repairProducedStateChange) {
                        log.warn(`sequence_retry_skipped_no_change: model=${context.selectedModel} attempt=${tentativeAttempt}`);
                    }

                    if (sequenceDecision.shouldRetry) {
                        const retryAttempt = sequenceDecision.nextAttempt;
                        const retryDelayMs = sequenceDecision.delayMs;
                        beginRecovery('sequence', `sequence_retry_${retryAttempt}`);
                        this.emitResilienceStatus(context,
                            {
                                code: 'SEQUENCE_REPAIR_RETRY',
                                category: 'sequence',
                                severity: 'warning',
                                retryable: true,
                                attempt: retryAttempt,
                                maxAttempts: sequenceDecision.maxAttempts,
                                nextDelayMs: retryDelayMs,
                                userMessage: `Repairing conversation... (${retryAttempt}/${sequenceDecision.maxAttempts})`,
                                action: 'retry'
                            }
                        );
                        this.emitResilienceTelemetryEvent('RESILIENCE_RETRY_SCHEDULED',
                            context,
                            'SEQUENCE_REPAIR_RETRY',
                            {
                                attempt: retryAttempt,
                                maxAttempts: sequenceDecision.maxAttempts,
                                nextDelayMs: retryDelayMs
                            }
                        );
                        this.sendMessageToWebview({
                            type: 'activityUpdate',
                            label: `Repairing conversation... (${retryAttempt}/${sequenceDecision.maxAttempts})`
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
                            this.emitResilienceStatus(context,
                                {
                                    code: 'REQUEST_STOPPED',
                                    category: 'request',
                                    severity: 'info',
                                    retryable: false,
                                    attempt: retryState.attempt,
                                    maxAttempts: retryState.attempt,
                                    userMessage: 'Request stopped.',
                                    action: 'none'
                                }
                            );
                            this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                                context,
                                'REQUEST_STOPPED',
                                { attempt: retryState.attempt, maxTokens }
                            );
                            this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                            this.sendMessageToWebview({ type: 'processingEnd' });
                            this.sendMessageToWebview({ type: 'generatingEnd' });
                            endRecovery('STREAMING', 'sequence_retry_stopped');
                            terminalizeTurn('stopped', 'stopped_during_sequence_retry');
                            return;
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
                        retryState.sequenceRetries += 1;
                        recoveryHint = {
                            category: 'sequence',
                            reason: 'sequence_repair_applied',
                            attempt: retryState.sequenceRetries,
                            maxAttempts: sequenceDecision.maxAttempts
                        };
                        endRecovery('STREAMING', 'sequence_retry_scheduled');
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        continue;
                    }
                }
                if (isSequenceError) {
                    this.emitResilienceStatus(context,
                        {
                            code: 'SEQUENCE_REPAIR_EXHAUSTED',
                            category: 'sequence',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.sequenceRetries,
                            maxAttempts: this.sequenceRetryMaxAttempts,
                            userMessage: 'Tool-call sequence could not be repaired automatically. Please retry or start a new conversation.',
                            action: 'switch_model'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'SEQUENCE_REPAIR_EXHAUSTED',
                        {
                            attempt: retryState.sequenceRetries,
                            maxAttempts: this.sequenceRetryMaxAttempts,
                            maxTokens
                        }
                    );
                    throw new Error('Tool-call sequence could not be repaired automatically. Please retry or start a new conversation.');
                }

                if (isEmptyResponseError) {
                    const emptyDecision = this.retryPolicyEngine.planRetry('empty', {
                        attemptsUsed: retryState.emptyResponseRetries,
                        stateChanged: true
                    });

                    if (!context.shouldStopStream && emptyDecision.shouldRetry) {
                        const retryAttempt = emptyDecision.nextAttempt;
                        const retryDelayMs = emptyDecision.delayMs;
                        beginRecovery('empty', `empty_response_retry_${retryAttempt}`);
                        this.emitResilienceStatus(context,
                            {
                                code: 'EMPTY_RESPONSE_DETECTED',
                                category: 'empty_response',
                                severity: 'warning',
                                retryable: true,
                                attempt: retryAttempt,
                                maxAttempts: emptyDecision.maxAttempts,
                                nextDelayMs: retryDelayMs,
                                userMessage: `No response received. Retrying... (${retryAttempt}/${emptyDecision.maxAttempts})`,
                                action: 'retry'
                            }
                        );
                        this.emitResilienceTelemetryEvent('RESILIENCE_RETRY_SCHEDULED',
                            context,
                            'EMPTY_RESPONSE_DETECTED',
                            {
                                attempt: retryAttempt,
                                maxAttempts: emptyDecision.maxAttempts,
                                nextDelayMs: retryDelayMs
                            }
                        );
                        this.sendMessageToWebview({
                            type: 'activityUpdate',
                            label: `No response received. Retrying... (${retryAttempt}/${emptyDecision.maxAttempts})`
                        });
                        await this.sleepWithStop(retryDelayMs, context);
                        if (context.shouldStopStream) {
                            this.emitResilienceStatus(context,
                                {
                                    code: 'REQUEST_STOPPED',
                                    category: 'request',
                                    severity: 'info',
                                    retryable: false,
                                    attempt: retryState.attempt,
                                    maxAttempts: retryState.attempt,
                                    userMessage: 'Request stopped.',
                                    action: 'none'
                                }
                            );
                            this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                                context,
                                'REQUEST_STOPPED',
                                { attempt: retryState.attempt, maxTokens }
                            );
                            this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                            this.sendMessageToWebview({ type: 'processingEnd' });
                            this.sendMessageToWebview({ type: 'generatingEnd' });
                            endRecovery('STREAMING', 'empty_response_retry_stopped');
                            terminalizeTurn('stopped', 'stopped_during_empty_retry');
                            return;
                        }
                        retryState.emptyResponseRetries += 1;
                        recoveryHint = {
                            category: 'empty_response',
                            reason: 'empty_response_retry_backoff',
                            attempt: retryState.emptyResponseRetries,
                            maxAttempts: emptyDecision.maxAttempts
                        };
                        endRecovery('STREAMING', 'empty_response_retry_scheduled');
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        continue;
                    }

                    this.logResilienceEvent(
                        'EMPTY_RESPONSE_RETRY_EXHAUSTED',
                        `model=${context.selectedModel} retries=${retryState.emptyResponseRetries}/${this.emptyResponseMaxRetries}`
                    );
                    this.emitResilienceStatus(context,
                        {
                            code: 'EMPTY_RESPONSE_RETRY_EXHAUSTED',
                            category: 'empty_response',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.emptyResponseRetries,
                            maxAttempts: this.emptyResponseMaxRetries,
                            userMessage: 'No assistant message was received after retries. Please retry or choose another model.',
                            action: 'switch_model'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'EMPTY_RESPONSE_RETRY_EXHAUSTED',
                        {
                            attempt: retryState.emptyResponseRetries,
                            maxAttempts: this.emptyResponseMaxRetries,
                            maxTokens
                        }
                    );
                    this.sendMessageToWebview({
                        type: 'error',
                        message: 'No assistant message was received after retries. Please retry or choose another model.',
                        code: 'EMPTY_RESPONSE_RETRY_EXHAUSTED',
                        action: 'switch_model'
                    });
                    throw new Error('No assistant message was received after retries.');
                }

                if (isRateLimitError) {
                    const retryAfterMs = error instanceof Error && 'retryAfterMs' in (error as any)
                        ? Number((error as any).retryAfterMs)
                        : undefined;
                    const rateLimitDecision = this.retryPolicyEngine.planRetry('rate_limit', {
                        attemptsUsed: retryState.rateLimitRetries,
                        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined
                    });

                    if (!context.shouldStopStream && rateLimitDecision.shouldRetry) {
                        const retryAttempt = rateLimitDecision.nextAttempt;
                        const retryDelayMs = rateLimitDecision.delayMs;
                        beginRecovery('rate_limit', `rate_limit_retry_${retryAttempt}`);
                        log.warn(`Rate limit detected. Retrying attempt ${retryAttempt}/${rateLimitDecision.maxAttempts} in ${retryDelayMs}ms (model=${context.selectedModel})`);
                        log.info(`Rate-limit retry planned: attempt=${retryAttempt} delayMs=${retryDelayMs} model=${context.selectedModel} max_tokens=${maxTokens}`);
                        this.emitResilienceStatus(context,
                            {
                                code: 'RATE_LIMIT_RETRY',
                                category: 'rate_limit',
                                severity: 'warning',
                                retryable: true,
                                attempt: retryAttempt,
                                maxAttempts: rateLimitDecision.maxAttempts,
                                nextDelayMs: retryDelayMs,
                                userMessage: `Provider busy. Retrying in ${Math.ceil(retryDelayMs / 1000)}s...`,
                                action: 'retry'
                            }
                        );
                        this.emitResilienceTelemetryEvent('RESILIENCE_RETRY_SCHEDULED',
                            context,
                            'RATE_LIMIT_RETRY',
                            {
                                attempt: retryAttempt,
                                maxAttempts: rateLimitDecision.maxAttempts,
                                nextDelayMs: retryDelayMs
                            }
                        );
                        this.sendMessageToWebview({ type: 'activityUpdate', label: `Provider busy. Retrying in ${Math.ceil(retryDelayMs / 1000)}s...` });
                        await this.sleepWithStop(retryDelayMs, context);
                        if (context.shouldStopStream) {
                            this.emitResilienceStatus(context,
                                {
                                    code: 'REQUEST_STOPPED',
                                    category: 'request',
                                    severity: 'info',
                                    retryable: false,
                                    attempt: retryState.attempt,
                                    maxAttempts: retryState.attempt,
                                    userMessage: 'Request stopped.',
                                    action: 'none'
                                }
                            );
                            this.emitResilienceTelemetryEvent('RESILIENCE_STOPPED_BY_USER',
                                context,
                                'REQUEST_STOPPED',
                                { attempt: retryState.attempt, maxTokens }
                            );
                            this.sendMessageToWebview({ type: 'activityUpdate', label: null });
                            this.sendMessageToWebview({ type: 'processingEnd' });
                            this.sendMessageToWebview({ type: 'generatingEnd' });
                            endRecovery('STREAMING', 'rate_limit_retry_stopped');
                            terminalizeTurn('stopped', 'stopped_during_rate_limit_retry');
                            return;
                        }
                        retryState.rateLimitRetries += 1;
                        recoveryHint = {
                            category: 'rate_limit',
                            reason: 'rate_limit_retry_backoff',
                            attempt: retryState.rateLimitRetries,
                            maxAttempts: rateLimitDecision.maxAttempts
                        };
                        endRecovery('STREAMING', 'rate_limit_retry_scheduled');
                        this.sendMessageToWebview({ type: 'generatingStart' });
                        continue;
                    }

                    this.emitResilienceStatus(context,
                        {
                            code: 'RATE_LIMIT_RETRY_EXHAUSTED',
                            category: 'rate_limit',
                            severity: 'error',
                            retryable: false,
                            attempt: retryState.rateLimitRetries,
                            maxAttempts: this.rateLimitMaxRetries,
                            userMessage: 'Provider is currently rate-limited. Please wait and retry.',
                            action: 'retry'
                        }
                    );
                    this.emitResilienceTelemetryEvent('RESILIENCE_TERMINAL_FAILURE',
                        context,
                        'RATE_LIMIT_RETRY_EXHAUSTED',
                        {
                            attempt: retryState.rateLimitRetries,
                            maxAttempts: this.rateLimitMaxRetries,
                            maxTokens
                        }
                    );
                    const freeModelHint = context.selectedModel.includes(':free')
                        ? ' Free providers are often saturated. Try again shortly or choose another model.'
                        : '';
                    log.error(`Rate limit retries exhausted: status=429 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                    throw new Error(`Provider is currently rate-limited. Please wait and retry.${freeModelHint}`);
                }

                if (isContextLengthError) {
                    log.error(`Context-length retry failed: status=400 model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                } else {
                    log.error(`OpenRouter request failed: model=${context.selectedModel} max_tokens=${maxTokens}`, error);
                }
                throw error;
            }
        }

        if (assistantMessage.length > 0 || toolCalls.length > 0 || incompleteToolCalls.length > 0) {
            if (toolCalls.length > 0 || incompleteToolCalls.length > 0) {
                transitionTurn('TOOL_EXEC', 'tool_dispatch_or_followup');
            }
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
                isFollowUp,
                retryCount
            );
        }
        const resumeProgressAfter = isResumeRun ? this.capturePlanProgressSnapshot() : null;
        const resumeNoProgressDetected = Boolean(
            isResumeRun &&
            toolCalls.length === 0 &&
            incompleteToolCalls.length === 0 &&
            !this.didPlanProgressAdvance(resumeProgressBefore, resumeProgressAfter)
        );

        if (resumeNoProgressDetected) {
            const currentAttempts = Math.max(0, Number(context.resumeNoProgressAttempts || 0));
            const nextAttempt = currentAttempts + 1;
            const maxAttempts = this.resumeNoProgressMaxAutoRetries + 1;
            this.emitResilienceStatus(context, {
                code: 'PLAN_RESUME_NO_PROGRESS',
                category: 'request',
                severity: currentAttempts < this.resumeNoProgressMaxAutoRetries ? 'warning' : 'error',
                retryable: currentAttempts < this.resumeNoProgressMaxAutoRetries,
                attempt: nextAttempt,
                maxAttempts,
                userMessage: currentAttempts < this.resumeNoProgressMaxAutoRetries
                    ? 'Approved plan produced no progress. Retrying once with stricter execution prompt.'
                    : 'Approved plan still produced no progress after automatic retry.',
                action: currentAttempts < this.resumeNoProgressMaxAutoRetries ? 'retry' : 'none'
            });
            this.emitResilienceTelemetryEvent(
                currentAttempts < this.resumeNoProgressMaxAutoRetries
                    ? 'RESILIENCE_RETRY_SCHEDULED'
                    : 'RESILIENCE_TERMINAL_FAILURE',
                context,
                'PLAN_RESUME_NO_PROGRESS',
                {
                    attempt: nextAttempt,
                    maxAttempts
                }
            );
            log.event(
                currentAttempts < this.resumeNoProgressMaxAutoRetries ? 'WARN' : 'ERROR',
                'PLAN_RESUME_NO_PROGRESS',
                'PLAN_RESUME_NO_PROGRESS',
                {
                    flowId: context.currentFlowId || null,
                    attempt: nextAttempt,
                    maxAttempts
                }
            );

            if (currentAttempts < this.resumeNoProgressMaxAutoRetries) {
                context.resumeNoProgressAttempts = nextAttempt;
                await this.generateAndStreamResponse(
                    context,
                    'Resume execution now. You must execute the approved plan, run required tools, and update plan step statuses. Do not only summarize. Start with step 1 immediately.',
                    retryCount + 1,
                    true
                );
                return;
            }

            throw new Error('PLAN_RESUME_NO_PROGRESS: Approved plan resume produced no tool or step progress.');
        }

        if (isResumeRun) {
            context.resumeNoProgressAttempts = 0;
        }

        this.sendMessageToWebview({ type: 'processingEnd' });
        // Ensure activity label is cleared after LLM completes (regardless of content)
        this.sendMessageToWebview({ type: 'activityUpdate', label: null });
        terminalizeTurn('completed', 'stream_completed');
        const successResult = this.createRuntimeResult({
            code: 'RESULT_SUCCESS',
            category: 'success',
            retryable: false,
            attempt: retryState.attempt,
            maxAttempts: maxTurns,
            usage,
            cost: totalCostUsd || null
        });
        await this.sessionHistoryManager.saveQueryRuntimeState({
            flowId: context.currentFlowId,
            turnId,
            phase: 'terminal',
            resultCode: successResult.code,
            attempt: successResult.attempt,
            maxAttempts: successResult.maxAttempts
        });
        this.emitRuntimeEvent({ type: 'result_success', flowId: context.currentFlowId, result: successResult });
        } catch (error) {
            if (context.shouldStopStream) {
                terminalizeTurn('stopped', 'top_level_stop');
            } else {
                terminalizeTurn('failed', 'top_level_failure');
            }
            const runtimeError = error instanceof Error ? error.message : String(error);
            const forcedCode =
                runtimeError.includes('PLAN_RESUME_NO_PROGRESS')
                    ? 'PLAN_RESUME_NO_PROGRESS'
                    : undefined;
            const errorCode: QueryRuntimeResult['code'] = context.shouldStopStream
                ? 'REQUEST_STOPPED'
                : forcedCode === 'PLAN_RESUME_NO_PROGRESS'
                    ? 'PLAN_RESUME_NO_PROGRESS'
                    : 'UNEXPECTED_FAILURE';
            const errorResult = this.createRuntimeResult({
                code: errorCode,
                category: context.shouldStopStream ? 'request' : 'runtime',
                retryable: false,
                attempt: 0,
                maxAttempts: maxTurns,
                usage: undefined,
                cost: null,
                message: runtimeError
            });
            await this.sessionHistoryManager.saveQueryRuntimeState({
                flowId: context.currentFlowId,
                turnId,
                phase: 'terminal',
                resultCode: errorResult.code,
                attempt: errorResult.attempt,
                maxAttempts: errorResult.maxAttempts
            });
            this.emitRuntimeEvent({ type: 'result_error', flowId: context.currentFlowId, result: errorResult });
            throw error;
        } finally {
            if (runAbortController && context.activeRunAbortController === runAbortController) {
                context.activeRunAbortController = null;
            }
            if (context.shouldStopStream && context.currentFlowId) {
                this.runIdByFlow.delete(context.currentFlowId);
            }
            if (turnEngine) {
                turnEngine.ensureTerminalized();
            }
        }
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
        isFollowUp: boolean,
        retryCount: number
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
            context.isToolExecutionActive = true;
            try {
                const dispatchOutcome = await this.toolCallDispatcher.handleToolCalls(toolCalls, messageId, context);
                if (!dispatchOutcome.ok) {
                    throw new Error(`${dispatchOutcome.terminalCode || 'TOOL_DISPATCH_TERMINAL_ERROR'}: ${dispatchOutcome.reason || 'Tool dispatch failed.'}`);
                }
            } finally {
                context.isToolExecutionActive = false;
            }
            return;
        }

        if (incompleteToolCalls.length > 0) {
            const retryPrompt = this.buildTruncationFollowUpPrompt(incompleteToolCalls[0], 1);
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
            await this.generateAndStreamResponse(context, retryPrompt, retryCount + 1, true);
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

    private buildTruncationFollowUpPrompt(incomplete: IncompleteToolCall, retryCount: number): string {
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
            totalChars: incomplete.charCount,
            retryCount
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

    private applyRecoveryNarrativeHint(
        messages: ChatMessage[],
        hint: { category: 'context' | 'sequence' | 'empty_response' | 'rate_limit'; reason: string; attempt: number; maxAttempts: number } | null
    ): ChatMessage[] {
        if (!hint) return messages;
        const recoveryCode = this.recoveryNarrativeCodeMap[hint.category];
        const narrative = [
            '[RECOVERY_NARRATIVE_V2]',
            `code=${recoveryCode}`,
            `reason=${hint.reason}`,
            `attempt=${hint.attempt}/${hint.maxAttempts}`,
            'rules=avoid repeating failed approach; keep response concise; preserve tool-call validity'
        ].join(' ');
        return [...messages, { role: 'system', content: narrative }];
    }

    private getToolsForMode(context: ChatViewContext): any[] | undefined {
        const mode = this.modeService.getCurrentMode();
        if (!mode) return this.agentManager.getFormattedTools();

        const tools = mode.getToolsForMode(this.agentManager);
        const config = vscode.workspace.getConfiguration('gently');
        const modeStateMachineV2Enabled = config.get<boolean>('modeStateMachineV2', true);
        const filtered = modeStateMachineV2Enabled ? filterToolsForModeContract(mode.id, tools || []) : tools;
        log.info(`getToolsForMode: mode=${mode.id}, returning ${filtered?.length || 0} tools`);
        return filtered;
    }

    private getSamplingOverrides(
        modelId: string,
        baseTemperature: number
    ): { temperature: number; topP?: number; topK?: number; reasoningConfig?: ReasoningConfig } {
        const policy = getModelPolicyResult(modelId);
        const config = vscode.workspace.getConfiguration('gently');
        const effortRaw = String(config.get<string>('modelPolicies.reasoningEffort', 'medium')).toLowerCase();
        const allowedEfforts: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        const effort: ReasoningEffort = allowedEfforts.includes(effortRaw as ReasoningEffort)
            ? effortRaw as ReasoningEffort
            : 'medium';
        const reasoningConfig = getReasoningConfig(modelId, effort, 'openrouter');

        const shouldUsePolicyTemperature = policy.family === 'minimax' || policy.family === 'claude';
        const temperature = shouldUsePolicyTemperature ? policy.recommendedTemperature : baseTemperature;
        log.info(JSON.stringify({
            'perf.phase': 'modelPolicySampling',
            duration_ms: 0,
            model: modelId,
            workspace: vscode.workspace.name || 'No workspace open',
            family: policy.family,
            temperature,
            top_p: policy.recommendedTopP,
            top_k: policy.recommendedTopK,
            reasoning_enabled: Object.keys(reasoningConfig).length > 0
        }));

        return {
            temperature,
            topP: policy.recommendedTopP,
            topK: policy.recommendedTopK,
            reasoningConfig: Object.keys(reasoningConfig).length > 0 ? reasoningConfig : undefined
        };
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
        const safeMax = modelContextLength - inputTokens - this.outputSafetyReserveTokens;
        const bounded = Math.min(userConfiguredMax, modelMaxOutput, safeMax);
        if (!Number.isFinite(bounded)) return 0;
        return Math.max(0, Math.floor(bounded));
    }

    private hasSufficientOutputBudget(
        inputTokens: number,
        modelContextLength: number,
        minOutputTokens: number
    ): boolean {
        return this.computeMaxOutputTokens(
            inputTokens,
            modelContextLength,
            Number.MAX_SAFE_INTEGER,
            Number.MAX_SAFE_INTEGER
        ) >= minOutputTokens;
    }

    private buildRecoverySignature(messages: ChatMessage[], inputTokens: number, maxTokens: number): string {
        const last = messages[messages.length - 1];
        return [
            messages.length,
            inputTokens,
            maxTokens,
            last?.role || 'none',
            last?.content?.length || 0
        ].join(':');
    }

    private runContextRecoveryStep(params: {
        context: ChatViewContext;
        systemPrompt: string;
        tools: any[] | undefined;
        modelContextLength: number;
        modelMaxOutput: number;
        configuredMaxTokens: number;
        rawMessages: ChatMessage[];
        compression: CompressionResult;
        messages: ChatMessage[];
        maxTokens: number;
        compressionLevel: 'none' | 'proactive' | 'aggressive';
        inputBudget: number;
        state: ContextRecoveryState;
    }): ContextRecoveryResult {
        const {
            context,
            systemPrompt,
            tools,
            modelContextLength,
            modelMaxOutput,
            configuredMaxTokens,
            compression,
            messages,
            maxTokens,
            compressionLevel,
            inputBudget,
            state
        } = params;
        const selectedModel = context.selectedModel || '';
        const signatureBefore = this.buildRecoverySignature(messages, compression.inputTokens, maxTokens);

        if (!state.attemptedAggressiveRecompress) {
            state.attemptedAggressiveRecompress = true;
            const nextCompressionLevel: 'aggressive' = 'aggressive';
            const nextInputBudget = this.computeInputBudgetTokens(modelContextLength, nextCompressionLevel);
            const nextRawMessages: ChatMessage[] = [
                { role: 'system' as const, content: systemPrompt },
                ...context.conversationHistory.map(toChatMessage),
            ];
            const nextCompression = this.tokenBudgetManager.compressMessagesForBudget(
                selectedModel,
                nextRawMessages,
                tools,
                nextInputBudget
            );
            const nextMessages = nextCompression.messages;
            const nextMaxTokens = this.computeMaxOutputTokens(
                nextCompression.inputTokens,
                modelContextLength,
                modelMaxOutput,
                configuredMaxTokens
            );
            const signatureAfter = this.buildRecoverySignature(nextMessages, nextCompression.inputTokens, nextMaxTokens);
            return {
                progressed: true,
                changed: signatureAfter !== signatureBefore,
                reason: 'aggressive_recompress',
                rawMessages: nextRawMessages,
                compression: nextCompression,
                messages: nextMessages,
                maxTokens: nextMaxTokens,
                compressionLevel: nextCompressionLevel,
                inputBudget: nextInputBudget,
                signature: signatureAfter
            };
        }

        if (!state.attemptedToolOutputPrune) {
            state.attemptedToolOutputPrune = true;
            const nextRawMessages: ChatMessage[] = [
                { role: 'system' as const, content: systemPrompt },
                ...context.conversationHistory.map(toChatMessage),
            ];
            const prune = this.tokenBudgetManager.pruneToolOutputsForContext(
                selectedModel,
                nextRawMessages,
                tools,
                inputBudget,
                {
                    protectTokens: this.toolOutputPruneProtectTokens,
                    protectedTurns: this.toolOutputPruneProtectedTurns
                }
            );
            const prunedCompression = this.tokenBudgetManager.compressMessagesForBudget(
                selectedModel,
                prune.messages,
                tools,
                inputBudget
            );
            const nextMessages = prunedCompression.messages;
            const nextMaxTokens = this.computeMaxOutputTokens(
                prunedCompression.inputTokens,
                modelContextLength,
                modelMaxOutput,
                configuredMaxTokens
            );
            const signatureAfter = this.buildRecoverySignature(nextMessages, prunedCompression.inputTokens, nextMaxTokens);
            return {
                progressed: true,
                changed: prune.prunedMessages > 0 && signatureAfter !== signatureBefore,
                reason: 'tool_output_prune',
                rawMessages: prune.messages,
                compression: prunedCompression,
                messages: nextMessages,
                maxTokens: nextMaxTokens,
                compressionLevel,
                inputBudget,
                signature: signatureAfter
            };
        }

        if (state.maxTokenReductionAttempts < 2) {
            state.maxTokenReductionAttempts += 1;
            const factor = state.maxTokenReductionAttempts === 1 ? 0.75 : 0.5;
            const reducedMaxTokens = Math.max(1, Math.floor(maxTokens * factor));
            const signatureAfter = this.buildRecoverySignature(messages, compression.inputTokens, reducedMaxTokens);
            return {
                progressed: true,
                changed: reducedMaxTokens < maxTokens,
                reason: 'max_tokens_reduce',
                rawMessages: params.rawMessages,
                compression,
                messages,
                maxTokens: reducedMaxTokens,
                compressionLevel,
                inputBudget,
                signature: signatureAfter
            };
        }

        return {
            progressed: false,
            changed: false,
            reason: 'exhausted',
            rawMessages: params.rawMessages,
            compression,
            messages,
            maxTokens,
            compressionLevel,
            inputBudget,
            signature: signatureBefore
        };
    }

    private getRateLimitDelayMs(retryAfterMs: number | undefined, retryAttempt: number): number {
        const backoff = Math.pow(2, retryAttempt - 1) * 1000;
        if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
            return Math.max(backoff, retryAfterMs);
        }
        return backoff;
    }

    private async sleepWithStop(delayMs: number, context: ChatViewContext): Promise<void> {
        await sleepWithAbort(delayMs, () => context.shouldStopStream === true);
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

    private logResilienceEvent(eventCode: string, details: string): void {
        log.info(`${eventCode}: ${details}`);
    }

    private emitResilienceStatus(
        context: ChatViewContext,
        status: {
            code: ResilienceStatusCode;
            category: ResilienceStatusCategory;
            severity: ResilienceStatusSeverity;
            retryable: boolean;
            attempt: number;
            maxAttempts: number;
            nextDelayMs?: number;
            userMessage: string;
            action: ResilienceStatusAction;
            phase?: 'preflight' | 'runtime' | 'retry' | 'terminal' | 'stopped';
            decision?: 'retry' | 'recover' | 'abort' | 'ignore' | 'report';
            reason?: string;
            correlationId?: string;
        }
    ): void {
        const correlationId = status.correlationId || this.createCorrelationId(context, status.code, status.attempt);
        this.emitRuntimeEvent({
            type: 'status',
            flowId: context.currentFlowId || 'flow-unknown',
            model: context.selectedModel || 'unknown',
            code: status.code,
            category: status.category,
            severity: status.severity,
            retryable: status.retryable,
            attempt: status.attempt,
            maxAttempts: status.maxAttempts,
            nextDelayMs: status.nextDelayMs,
            userMessage: status.userMessage,
            action: status.action,
            phase: status.phase || 'runtime',
            decision: status.decision || 'report',
            reason: status.reason || 'unspecified',
            correlationId
        });
    }

    private emitResilienceTelemetryEvent(
        eventName:
            | 'RESILIENCE_ATTEMPT_START'
            | 'RESILIENCE_RETRY_SCHEDULED'
            | 'RESILIENCE_RECOVERY_APPLIED'
            | 'RESILIENCE_TERMINAL_FAILURE'
            | 'RESILIENCE_STOPPED_BY_USER',
        context: ChatViewContext,
        code: ResilienceTelemetryCode,
        metadata: Record<string, unknown> = {}
    ): void {
        const correlationId = String(metadata.correlationId || this.createCorrelationId(context, code, Number(metadata.attempt || 0)));
        const level =
            eventName === 'RESILIENCE_TERMINAL_FAILURE'
                ? 'ERROR'
                : eventName === 'RESILIENCE_RETRY_SCHEDULED'
                    ? 'WARN'
                    : 'INFO';
        log.event(level, eventName, `${eventName}:${code}`, {
            code,
            model: context.selectedModel || 'unknown',
            mode: context.selectedMode || 'unknown',
            flowId: context.currentFlowId || null,
            correlationId,
            ...metadata
        });
    }

    private createCorrelationId(context: ChatViewContext, code: ResilienceTelemetryCode, attempt: number): string {
        const flow = context.currentFlowId || 'flow-unknown';
        const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
        return `${flow}:${code}:${normalizedAttempt}`;
    }

    private isStoppedByUserError(error: unknown): boolean {
        const message = String((error as any)?.message || error || '').toLowerCase();
        return (
            message.includes('request stopped by user') ||
            message.includes('request aborted') ||
            message.includes('operation was aborted') ||
            message.includes('aborterror')
        );
    }

    private async commitCompressedHistory(
        context: ChatViewContext,
        compressedMessages: ChatMessage[],
        messageIdentityMap: Map<ChatMessage, string>,
        meta: { droppedCount: number; summaryInserted: boolean; source: 'budget' | 'overflow_rescue' }
    ): Promise<boolean> {
        const historyWithoutSystem = compressedMessages.slice(1);
        const repaired = this.toolCallManager.repairConversationHistory(historyWithoutSystem);
        const normalizedHistory = repaired.repaired ? repaired.messages : historyWithoutSystem;
        const compressedHistory = normalizedHistory.map((chatMessage) => {
            const mappedId = messageIdentityMap.get(chatMessage);
            return fromChatMessage(chatMessage, mappedId);
        });

        try {
            const activeSession = await this.sessionHistoryManager.getActiveSession(SessionType.CHAT);
            if (!activeSession) {
                this.sendMessageToWebview({
                    type: 'info',
                    message: 'Compression skipped: no active session available for durable sync.'
                });
                return false;
            }

            const chatProvider = this.sessionHistoryManager.getChatProvider();
            if (!chatProvider) {
                this.sendMessageToWebview({
                    type: 'info',
                    message: 'Compression skipped: chat provider unavailable for durable sync.'
                });
                return false;
            }

            await chatProvider.updateSession(activeSession.id, { messages: compressedHistory });
            context.conversationHistory = compressedHistory;
            await this.sessionHistoryManager.appendQueryRuntimeBoundary({
                reason: meta.source,
                droppedCount: meta.droppedCount
            });
            this.emitRuntimeEvent({
                type: 'compaction_boundary',
                flowId: context.currentFlowId || 'flow-unknown',
                reason: meta.source,
                droppedCount: meta.droppedCount
            });
            this.sendMessageToWebview({
                type: 'messagesCompressed',
                droppedCount: meta.droppedCount,
                summaryInserted: meta.summaryInserted,
                source: meta.source,
                remainingMessages: compressedHistory
            } as any);
            return true;
        } catch (error) {
            log.error('Failed to commit compressed history atomically', error);
            this.sendMessageToWebview({
                type: 'error',
                message: 'Compression could not be persisted. Keeping current history unchanged.'
            });
            return false;
        }
    }

    private emitRuntimeEvent(event: QueryRuntimeEvent): void {
        const flowIdForRun = typeof (event as any)?.flowId === 'string' ? String((event as any).flowId) : '';
        const runId = flowIdForRun ? this.runIdByFlow.get(flowIdForRun) : undefined;
        if (event.type === 'result_success' || event.type === 'result_error') {
            const flowId = typeof event.flowId === 'string' ? event.flowId : '';
            if (flowId) {
                const previousTerminal = this.terminalRuntimeEventByFlow.get(flowId);
                if (previousTerminal) {
                    // Keep the first terminal event per flow deterministic.
                    return;
                }
                this.terminalRuntimeEventByFlow.set(flowId, event.type);
                this.terminalRuntimeEventOrder.push(flowId);
                while (this.terminalRuntimeEventOrder.length > this.maxTrackedTerminalFlows) {
                    const stale = this.terminalRuntimeEventOrder.shift();
                    if (stale) this.terminalRuntimeEventByFlow.delete(stale);
                }
                this.runIdByFlow.delete(flowId);
            }
        }

        const runtimeEventWithRunId = runId
            ? ({ ...(event as any), runId } as QueryRuntimeEvent)
            : event;
        if (this.onRuntimeEvent) {
            this.onRuntimeEvent(runtimeEventWithRunId);
        }
        this.sendMessageToWebview({
            type: 'queryRuntimeEvent',
            event: runtimeEventWithRunId
        } as any);
    }

    private createRuntimeResult(input: {
        code: QueryRuntimeResult['code'];
        category: QueryRuntimeResult['category'];
        retryable: boolean;
        attempt: number;
        maxAttempts: number;
        usage: UsageInfo | undefined;
        cost: number | null;
        message?: string;
    }): QueryRuntimeResult {
        return {
            code: input.code,
            category: input.category,
            retryable: input.retryable,
            attempt: input.attempt,
            maxAttempts: input.maxAttempts,
            stopReason: input.code === 'RESULT_SUCCESS' ? 'completed' : null,
            usage: {
                promptTokens: input.usage?.prompt_tokens || 0,
                completionTokens: input.usage?.completion_tokens || 0,
                totalTokens: input.usage?.total_tokens || 0,
                cacheReadInputTokens: input.usage?.cache_read_input_tokens || 0,
                cacheWriteInputTokens: input.usage?.cache_write_input_tokens || 0
            },
            cost: input.cost,
            permissionDenials: [...this.permissionDenials],
            message: input.message
        };
    }

    private capturePlanProgressSnapshot(): { planId: string; completedSteps: number; nonPendingSteps: number } | null {
        const plan = this.agentManager.getPlanningManager?.()?.getCurrentPlan?.();
        if (!plan || !Array.isArray(plan.steps)) return null;
        const completedSteps = plan.steps.filter((step: any) => String(step?.status || '').toLowerCase() === 'completed').length;
        const nonPendingSteps = plan.steps.filter((step: any) => {
            const status = String(step?.status || '').toLowerCase();
            return status !== 'pending' && status !== '';
        }).length;
        return {
            planId: String(plan.id || ''),
            completedSteps,
            nonPendingSteps
        };
    }

    private didPlanProgressAdvance(
        before: { planId: string; completedSteps: number; nonPendingSteps: number } | null,
        after: { planId: string; completedSteps: number; nonPendingSteps: number } | null
    ): boolean {
        if (!before || !after) return false;
        if (!before.planId || !after.planId || before.planId !== after.planId) return false;
        if (after.completedSteps > before.completedSteps) return true;
        if (after.nonPendingSteps > before.nonPendingSteps) return true;
        return false;
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


