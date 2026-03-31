import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { ChatViewContext, Message } from '../types/ChatTypes';
import { ToolCallUtils } from '../utils/ToolCallUtils';
import { LogService } from '../../../services/LogService';
import { ToolCallManager } from '../toolcall';
import { FollowUpHandler } from './SequenceManagers';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';
import { ToolCall } from '../../../services/OpenRouterService';
import { PlanStep } from '../../../agent/planning/types';
import { ToolResultErrorCodes, ToolResultErrorCode } from '../toolcall/ToolResultErrorCodes';
import { buildMonolithRetryPrompt, buildOversizeRetryPrompt, buildTruncatedRetryPrompt } from '../toolcall/ToolRetryPrompts';
import { LoopDetector, isStrategicSwitch } from '../../../core/resilience/LoopDetector';
import { NotificationPayload } from '../../../hooks/types';

import { PlanningManager } from '../../../agent/agentManager/PlanningManager';

const log = new LogService('ExecutionDispatchers');
const MAX_TOOL_RESULT_SIZE = 100_000;
const DOOM_LOOP_HISTORY_LIMIT = 30;
const MODE_SWITCH_LOOP_THRESHOLD = 3;
const MODE_SWITCH_HISTORY_LIMIT = 20;

interface PostToolActionResult {
    requestedMode?: string;
    shouldAutoContinue?: boolean;
    continuationPrompt?: string;
}

interface GuardrailConfig {
    monolithPolicy: 'warn' | 'block';
    maxInlineLines: number;
    growthLineThreshold: number;
}

/**
 * Handles traditional, parallel tool execution logic.
 */
export class TraditionalToolExecutor {
    private fileLocks: Map<string, Promise<void>> = new Map();
    private toolArgsTruncatedCount = 0;
    private toolArgsOversizeRejectedCount = 0;
    private partialRecoverySuccessCount = 0;
    private largestToolArgSeen = 0;
    private readonly loopDetector = new LoopDetector(3, 5);

    constructor(
        private readonly agentManager: AgentManager,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly updateConversationHistory: (message: Message) => void,
        private readonly triggerFollowUpMessage: (message?: string) => Promise<void>,
        private readonly performModeSwitch: (modeId: string) => Promise<void>,
        private readonly sendContinuationMessage: (message: string) => Promise<void>
    ) { }

    public async execute(toolCalls: ToolCall[], messageId: string, context: ChatViewContext): Promise<void> {
        try {
            log.info(`[PARALLEL] Handling ${toolCalls.length} tool calls in parallel`);
            const startTime = Date.now();

            await this.createCheckpointIfNeeded(toolCalls, messageId, context);

            const { validToolCalls, invalidToolCalls, warnings } = ToolCallUtils.validateAndRepairToolCalls(toolCalls, {
                model: context.selectedModel || undefined,
                guardrailPolicy: this.getGuardrailConfig()
            });

            if (warnings.length > 0) {
                warnings.forEach((warning) => {
                    log.warn(warning);
                    this.sendMessageToWebview({ type: 'info', message: warning });
                });
            }

            if (invalidToolCalls.length > 0) {
                await this.handleInvalidToolCalls(invalidToolCalls, toolCalls, context);
                if (validToolCalls.length === 0) return;
            }

            const results = await this.executeToolCallsParallel(validToolCalls, context);
            const resultById = new Map(results.map((entry) => [entry.toolCall.id, entry]));

            let postAction: PostToolActionResult | null = null;

            for (const toolCall of validToolCalls) {
                const match = resultById.get(toolCall.id);
                if (!match) continue;
                const serializedResult = this.serializeAndTruncateToolResult(match.result);
                this.updateConversationHistory({
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    timestamp: Date.now(),
                    role: 'tool',
                    content: serializedResult,
                    toolName: toolCall.function?.name,
                    tool_call_id: toolCall.id,
                });

                if (match.success) {
                    context.consecutiveMistakeCount = 0;
                } else {
                    context.consecutiveMistakeCount = (context.consecutiveMistakeCount || 0) + 1;
                }

                if (!postAction) {
                    postAction = this.extractPostToolAction(match.result);
                }
            }

            if (postAction && (postAction.shouldAutoContinue || postAction.requestedMode)) {
                await this.handlePostToolAction(context, postAction);
                return;
            }

            await this.triggerFollowUpMessage("\n[SYSTEM NOTE: The tools have finished executing. Review the results. If you made ANY architectural decisions, established new project rules, or learned important workflow facts that should persist across sessions, IMMEDIATELY call the `update_memory_bank` tool to document them. If not, simply summarize the results and continue.]");

        } catch (error) {
            log.error('Error in traditional tool execution:', error);
            this.sendMessageToWebview({
                type: 'error',
                message: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
            });
        }
    }

    private async createCheckpointIfNeeded(toolCalls: ToolCall[], messageId: string, context: ChatViewContext): Promise<void> {
        const flowId = context.currentFlowId;
        if (flowId && context.agentMode && !context.messageCheckpoints.has(flowId)) {
            try {
                const filePaths = ToolCallUtils.extractFilePathsFromToolCalls(toolCalls);
                if (filePaths.size > 0) {
                    const checkpoint = await this.agentManager.createCheckpoint(flowId, `Before implementing changes`, Array.from(filePaths));
                    context.messageCheckpoints.set(flowId, checkpoint.id);
                    this.sendMessageToWebview({ type: 'checkpointCreated', messageId, checkpointId: checkpoint.id, checkpointNumber: checkpoint.checkpointNumber, filesTracked: filePaths.size });
                }
            } catch (error) {
                log.error('Failed to create checkpoint:', error);
            }
        }
    }

    private async handleInvalidToolCalls(
        invalidToolCalls: Array<{ toolCall: ToolCall; index: number; error: string; code?: ToolResultErrorCode; details?: Record<string, unknown> }>,
        allToolCalls: ToolCall[],
        context: ChatViewContext
    ): Promise<void> {
        this.trackInvalidToolCallMetrics(invalidToolCalls);
        if (invalidToolCalls.length === allToolCalls.length) {
            let errorMessage = '❌ All tool calls have invalid JSON arguments:\n\n';
            invalidToolCalls.forEach(({ toolCall, index, error }) => {
                errorMessage += `Tool ${index + 1} (${toolCall.function?.name || 'unknown'}):\n${error}\n\n`;
            });
            const enrichedPrompt = this.buildInvalidToolRetryPrompt(invalidToolCalls, context) || errorMessage;
            this.sendMessageToWebview({ type: 'error', message: 'KI hat ungültige JSON-Argumente generiert.' });
            this.updateConversationHistory({ id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), role: 'user', content: enrichedPrompt });
            await this.triggerFollowUpMessage(enrichedPrompt);
        }
    }

    private buildInvalidToolRetryPrompt(
        invalidToolCalls: Array<{ toolCall: ToolCall; index: number; error: string; code?: ToolResultErrorCode; details?: Record<string, unknown> }>,
        context: ChatViewContext
    ): string | null {
        const retryCount = Math.max(1, Number(context?.consecutiveMistakeCount || 0) + 1);
        const truncated = invalidToolCalls.find((entry) => entry.code === ToolResultErrorCodes.TOOL_ARGS_TRUNCATED);
        if (truncated) {
            const details = truncated.details || {};
            const partialFields = (details.partialFields as Record<string, unknown>) || {};
            const recoveredPath = typeof partialFields.path === 'string'
                ? partialFields.path
                : (typeof partialFields.file_path === 'string' ? partialFields.file_path : undefined);
            const contentPreview = typeof partialFields.content === 'string'
                ? partialFields.content
                : (typeof partialFields.new_content === 'string' ? partialFields.new_content : String(details.rawPreview || ''));
            const totalChars = Number(details.charCount || 0);
            return buildTruncatedRetryPrompt({
                toolName: truncated.toolCall.function?.name || 'unknown_tool',
                recoveredPath,
                contentPreview,
                totalChars,
                retryCount
            });
        }

        const oversize = invalidToolCalls.find((entry) => entry.code === ToolResultErrorCodes.TOOL_ARGS_TOO_LARGE);
        if (oversize) {
            const details = oversize.details || {};
            return buildOversizeRetryPrompt({
                toolName: oversize.toolCall.function?.name || 'unknown_tool',
                actualSize: Number(details.actualSize || 0),
                path: typeof details.path === 'string' ? details.path : undefined,
                retryCount
            });
        }

        const monolith = invalidToolCalls.find((entry) => entry.code === ToolResultErrorCodes.TOOL_MONOLITH_POLICY_VIOLATION);
        if (monolith) {
            const details = monolith.details || {};
            return buildMonolithRetryPrompt({
                toolName: monolith.toolCall.function?.name || 'unknown_tool',
                path: typeof details.path === 'string' ? details.path : undefined,
                inlineViolations: Array.isArray(details.inlineViolations) ? details.inlineViolations as string[] : [],
                suggestions: Array.isArray(details.suggestions) ? details.suggestions as string[] : [],
                retryCount
            });
        }

        return null;
    }

    private trackInvalidToolCallMetrics(
        invalidToolCalls: Array<{ code?: ToolResultErrorCode; details?: Record<string, unknown> }>
    ): void {
        for (const invalid of invalidToolCalls) {
            if (invalid.code === ToolResultErrorCodes.TOOL_ARGS_TRUNCATED) {
                this.toolArgsTruncatedCount += 1;
                const partialFields = (invalid.details?.partialFields as Record<string, unknown>) || {};
                if (Object.keys(partialFields).length > 0) {
                    this.partialRecoverySuccessCount += 1;
                }
            }
            if (invalid.code === ToolResultErrorCodes.TOOL_ARGS_TOO_LARGE) {
                this.toolArgsOversizeRejectedCount += 1;
            }
            const seenSize = Number(invalid.details?.charCount || invalid.details?.actualSize || 0);
            if (seenSize > this.largestToolArgSeen) {
                this.largestToolArgSeen = seenSize;
            }
        }

        log.info(
            `tool_arg_metrics: truncated=${this.toolArgsTruncatedCount} oversize=${this.toolArgsOversizeRejectedCount} ` +
            `partialRecovery=${this.partialRecoverySuccessCount} largestArg=${this.largestToolArgSeen}`
        );
    }

    private getGuardrailConfig(): GuardrailConfig {
        const config = vscode.workspace.getConfiguration('gently');
        const monolithPolicy = config.get<'warn' | 'block'>('monolithPolicy', 'warn');
        const maxInlineLines = config.get<number>('maxInlineLines', 20);
        const growthLineThreshold = config.get<number>('growthLineThreshold', 500);
        return {
            monolithPolicy: monolithPolicy === 'block' ? 'block' : 'warn',
            maxInlineLines: Number.isFinite(maxInlineLines) && maxInlineLines > 0 ? Math.floor(maxInlineLines) : 20,
            growthLineThreshold: Number.isFinite(growthLineThreshold) && growthLineThreshold > 0 ? Math.floor(growthLineThreshold) : 500
        };
    }

    private async executeToolCallsParallel(toolCalls: ToolCall[], context: ChatViewContext): Promise<{ toolCall: ToolCall, result: any, success: boolean }[]> {
        const toolManager = this.agentManager.getToolManager();
        const mappedCalls: { id: string; name: string; params: any }[] = [];
        const blockedResults: { toolCall: ToolCall, result: any, success: boolean }[] = [];

        for (const toolCall of toolCalls) {
            const parsed = ToolCallUtils.repairAndParseJSON(toolCall.function.arguments).repaired;
            const toolName = toolCall.function.name;
            const fingerprint = this.buildToolFingerprint(toolName, parsed);
            const loopState = this.getLoopState(context);
            const loopResult = this.loopDetector.check(loopState, fingerprint);

            if (loopResult.hardEscalation && !context.doomLoopAllowedTools?.has(toolName)) {
                const errorMessage = `LOOP_HARD_ESCALATION: blocked repeated ${toolName} execution (count=${loopResult.count}).`;
                const metadata = { toolName, fingerprint, count: loopResult.count, action: 'abort' };
                blockedResults.push({
                    toolCall,
                    result: { error: errorMessage },
                    success: false
                });
                log.event('ERROR', 'loop.hard_block', errorMessage, metadata);
                await this.emitNotification({
                    channel: 'loop_escalation',
                    severity: 'error',
                    action: 'abort',
                    message: errorMessage,
                    metadata
                });
                continue;
            }

            if (loopResult.softWarning && !context.doomLoopAllowedTools?.has(toolName)) {
                log.event('WARN', 'loop.soft_warning', `Loop soft warning for ${toolName}`, {
                    toolName,
                    fingerprint,
                    count: loopResult.count,
                    action: 'retry'
                });
                await this.emitNotification({
                    channel: 'loop_escalation',
                    severity: 'warning',
                    action: 'retry',
                    message: `Loop soft warning for ${toolName} (count=${loopResult.count})`,
                    metadata: { toolName, fingerprint, count: loopResult.count }
                });
                const decision = await this.askDoomLoopPermission(toolName);
                if (decision === 'stop') {
                    blockedResults.push({
                        toolCall,
                        result: { error: `Execution blocked by user after soft loop warning for ${toolName}.` },
                        success: false
                    });
                    continue;
                }
                if (decision === 'always') {
                    if (!context.doomLoopAllowedTools) {
                        context.doomLoopAllowedTools = new Set<string>();
                    }
                    context.doomLoopAllowedTools.add(toolName);
                }
            }

            this.pushDoomLoopFingerprint(context, fingerprint);
            mappedCalls.push({
                id: toolCall.id,
                name: toolName,
                params: parsed
            });
        }

        const executionResults = mappedCalls.length > 0
            ? await toolManager.executeTools(mappedCalls)
            : [];

        const computedResults = executionResults.map(r => {
            const originalCall = toolCalls.find(tc => tc.id === r.id)!;
            return {
                toolCall: originalCall,
                result: r.result,
                success: !r.result.error
            };
        });

        return [...blockedResults, ...computedResults];
    }

    private serializeAndTruncateToolResult(result: any): string {
        let serialized: string;
        if (typeof result === 'string') {
            serialized = result;
        } else {
            try {
                serialized = JSON.stringify(result);
            } catch {
                serialized = String(result);
            }
        }

        if (serialized.length <= MAX_TOOL_RESULT_SIZE) {
            return serialized;
        }

        const originalLength = serialized.length;
        return `${serialized.slice(0, MAX_TOOL_RESULT_SIZE)}\n\n---\n[TRUNCATED: Full output was ${originalLength} chars. Use grep or search tools to find specific content.]`;
    }

    private buildToolFingerprint(toolName: string, args: unknown): string {
        const stableArgs = this.stableStringify(args);
        const hash = createHash('sha256').update(stableArgs).digest('hex').slice(0, 16);
        return `${toolName}:${hash}`;
    }

    private stableStringify(value: unknown): string {
        if (value === null || value === undefined) return 'null';
        if (typeof value !== 'object') return JSON.stringify(value);
        if (Array.isArray(value)) {
            return `[${value.map((entry) => this.stableStringify(entry)).join(',')}]`;
        }
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${this.stableStringify(entry)}`);
        return `{${entries.join(',')}}`;
    }

    private pushDoomLoopFingerprint(context: ChatViewContext, fingerprint: string): void {
        const history = Array.isArray(context.recentToolCallFingerprints)
            ? context.recentToolCallFingerprints
            : [];
        history.push(fingerprint);
        while (history.length > DOOM_LOOP_HISTORY_LIMIT) history.shift();
        context.recentToolCallFingerprints = history;
    }

    private async shouldPromptDoomLoop(context: ChatViewContext, toolName: string, fingerprint: string): Promise<boolean> {
        if (context.doomLoopAllowedTools?.has(toolName)) {
            return false;
        }
        const history = Array.isArray(context.recentToolCallFingerprints)
            ? context.recentToolCallFingerprints
            : [];
        const lastTwo = history.slice(-2);
        return lastTwo.length === 2 && lastTwo.every((item) => item === fingerprint);
    }

    private async askDoomLoopPermission(toolName: string): Promise<'continue' | 'always' | 'stop'> {
        const choice = await vscode.window.showWarningMessage(
            `Repeated identical "${toolName}" tool calls detected. Continue execution?`,
            { modal: true },
            'Weiter',
            'Immer fuer dieses Tool (Session)',
            'Stop'
        );
        if (choice === 'Weiter') return 'continue';
        if (choice === 'Immer fuer dieses Tool (Session)') return 'always';
        return 'stop';
    }

    private extractPostToolAction(result: unknown): PostToolActionResult | null {
        if (!result || typeof result !== 'object') return null;
        const candidate = result as Record<string, unknown>;
        const requestedMode = typeof candidate.requestedMode === 'string' && candidate.requestedMode.trim() !== ''
            ? candidate.requestedMode.trim()
            : undefined;
        const shouldAutoContinue = Boolean(candidate.shouldAutoContinue);
        const continuationPrompt = typeof candidate.continuationPrompt === 'string' && candidate.continuationPrompt.trim() !== ''
            ? candidate.continuationPrompt.trim()
            : undefined;

        if (!requestedMode && !shouldAutoContinue && !continuationPrompt) return null;
        return { requestedMode, shouldAutoContinue, continuationPrompt };
    }

    private async handlePostToolAction(context: ChatViewContext, result: PostToolActionResult): Promise<void> {
        let continuationPrompt = result.continuationPrompt || 'Continue with the next step now.';
        if (result.requestedMode) {
            if (this.shouldSkipModeSwitch(context, result.requestedMode)) {
                log.warn(`Duplicate mode switch detected, skipping mode="${result.requestedMode}"`);
            } else {
                try {
                    const previousMode = context.selectedMode;
                    await this.performModeSwitch(result.requestedMode);
                    this.recordModeSwitch(context, result.requestedMode);
                    if (isStrategicSwitch(previousMode, result.requestedMode)) {
                        this.loopDetector.reset(this.getLoopState(context));
                    }
                    context.selectedMode = result.requestedMode;
                } catch (error) {
                    log.warn(`Mode switch failed, continuing in current mode: ${error instanceof Error ? error.message : String(error)}`);
                    continuationPrompt = `Mode switch failed. Continue in current mode. ${continuationPrompt}`;
                }
            }
        }

        await this.sendContinuationMessage(continuationPrompt);
    }

    private shouldSkipModeSwitch(context: ChatViewContext, modeId: string): boolean {
        const history = Array.isArray(context.recentModeSwitches) ? context.recentModeSwitches : [];
        if (history.length < MODE_SWITCH_LOOP_THRESHOLD - 1) return false;
        const recent = history.slice(-(MODE_SWITCH_LOOP_THRESHOLD - 1));
        return recent.every((entry) => entry === modeId);
    }

    private recordModeSwitch(context: ChatViewContext, modeId: string): void {
        const history = Array.isArray(context.recentModeSwitches) ? context.recentModeSwitches : [];
        history.push(modeId);
        while (history.length > MODE_SWITCH_HISTORY_LIMIT) history.shift();
        context.recentModeSwitches = history;
    }

    private getLoopState(context: ChatViewContext): { lastSignature?: string; count: number } {
        if (!context.loopDetectorState) {
            context.loopDetectorState = { count: 0 };
        }
        return context.loopDetectorState;
    }

    private async emitNotification(payload: NotificationPayload): Promise<void> {
        await this.agentManager.getHookManager().executeNotification(payload);
    }
}

/**
 * Handles iterative execution of complex goals.
 */
export class IterativePlanExecutor {
    constructor(
        private readonly agentManager: AgentManager,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly fallback: (toolCalls: ToolCall[], messageId: string, context: ChatViewContext) => Promise<void>
    ) { }

    async handleIterativePlanning(createPlanCall: ToolCall, context: ChatViewContext): Promise<void> {
        try {
            const repairResult = ToolCallUtils.repairAndParseJSON(createPlanCall.function.arguments);
            if (repairResult.success && repairResult.repaired?.goal) {
                const { goal, steps } = repairResult.repaired;
                
                // If the LLM provided explicit steps, we use them instead of just the goal
                if (steps && Array.isArray(steps) && steps.length > 0) {
                    log.info(`[ITERATIVE] Creating plan with ${steps.length} provided steps`);
                    const plan = this.agentManager.getPlanningManager().createPlan({ goal, steps });
                    const executionContext = await (this.agentManager as any).executeGoalIteratively(goal, new Map(), {});
                    this.sendMessageToWebview({ type: 'iterativePlanCompleted', goal, totalSteps: executionContext.completed_steps?.length || 0, totalTime: executionContext.total_execution_time });
                } else {
                    // Fallback to traditional if no steps provided
                    await this.fallback([createPlanCall], '', context);
                }

                if (context.currentFlowId) context.currentFlowId = undefined;
            } else {
                await this.fallback([createPlanCall], '', context);
            }
        } catch (error) {
            log.error('Iterative planning failed, falling back:', error);
            await this.fallback([createPlanCall], '', context);
        }
    }
}

/**
 * Orchestrates tool call execution (deciding between iterative and traditional).
 */
export class ToolExecutionHandler {
    private iterative: IterativePlanExecutor;
    private traditional: TraditionalToolExecutor;

    constructor(
        private agentManager: AgentManager,
        sendMessageToWebview: (message: any) => void,
        updateConversationHistory: (message: Message) => void,
        triggerFollowUpMessage: (message?: string) => Promise<void>,
        performModeSwitch: (modeId: string) => Promise<void>,
        sendContinuationMessage: (message: string) => Promise<void>
    ) {
        this.traditional = new TraditionalToolExecutor(
            agentManager,
            sendMessageToWebview,
            updateConversationHistory,
            triggerFollowUpMessage,
            performModeSwitch,
            sendContinuationMessage
        );
        this.iterative = new IterativePlanExecutor(agentManager, sendMessageToWebview, (tc, mid, ctx) => this.traditional.execute(tc, mid, ctx));
    }

    async handleToolCalls(toolCalls: any[], messageId: string, context: ChatViewContext): Promise<void> {
        try {
            await new Promise(resolve => setTimeout(resolve, 100));
            const userMsg = context.conversationHistory[context.conversationHistory.length - 2]?.content || '';
            const createPlanCall = toolCalls.find(tc => tc.function?.name === 'create_plan');

            if (createPlanCall && this.agentManager.shouldUseIterativePlanning(userMsg)) {
                await this.iterative.handleIterativePlanning(createPlanCall, context);
            } else {
                await this.traditional.execute(toolCalls, messageId, context);
            }
        } catch (error) {
            log.error('Tool execution failed:', error);
        }
    }
}

/**
 * High-level dispatcher for tool calls.
 */
export class ToolCallDispatcher {
    private executionHandler: ToolExecutionHandler;

    constructor(
        private toolCallManager: ToolCallManager,
        private followUp: FollowUpHandler,
        private sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        agentManager: AgentManager,
        updateConversationHistory: (message: Message) => void,
        triggerFollowUpMessage: (message?: string) => Promise<void>,
        performModeSwitch: (modeId: string) => Promise<void>,
        sendContinuationMessage: (message: string) => Promise<void>
    ) { 
        this.executionHandler = new ToolExecutionHandler(
            agentManager, 
            sendMessageToWebview, 
            updateConversationHistory, 
            triggerFollowUpMessage,
            performModeSwitch,
            sendContinuationMessage
        );
    }

    async handleToolCalls(toolCalls: ToolCall[], messageId: string, context: ChatViewContext): Promise<void> {
        try {
            if (!toolCalls || toolCalls.length === 0) {
                await this.followUp.sendFollowUpMessage(context, '');
                return;
            }

            // 1. Validate via ToolCallManager
            const mappedToolCalls = toolCalls.map(tc => ({
                id: tc.id,
                type: tc.type,
                function: tc.function,
                status: 'pending' as const
            }));

            const validationResult = await this.toolCallManager.processToolCalls(mappedToolCalls, {
                conversationHistory: context.conversationHistory.map(msg => ({ role: msg.role as any, content: msg.content, tool_calls: msg.tool_calls, tool_call_id: msg.tool_call_id })),
                messageId, flowId: context.currentFlowId, selectedMode: context.selectedMode
            } as any);

            if (validationResult.valid) {
                // 2. Execute via ToolExecutionHandler
                log.info(`Validation successful, executing ${toolCalls.length} tool calls`);
                await this.executionHandler.handleToolCalls(toolCalls, messageId, context);
            } else {
                log.error(`Validation failed: ${validationResult.errors.join(', ')}`);
                this.sendMessageToWebview({ type: 'error', message: `Validation failed: ${validationResult.errors.join(', ')}` });
            }
        } catch (error: any) {
            log.error('Dispatch failed:', error);
            this.sendMessageToWebview({ type: 'error', message: `Execution error: ${error.message}` });
        }
    }
}
