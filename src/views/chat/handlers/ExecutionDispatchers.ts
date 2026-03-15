import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { ChatViewContext, Message } from '../types/ChatTypes';
import { ToolCallUtils } from '../utils/ToolCallUtils';
import { LogService } from '../../../services/LogService';
import { ToolCallManager } from '../toolcall';
import { FollowUpHandler } from './SequenceManagers';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';
import { ToolCall } from '../../../services/OpenRouterService';
import { PlanStep } from '../../../agent/planning/types';

import { PlanningManager } from '../../../agent/agentManager/PlanningManager';

const log = new LogService('ExecutionDispatchers');

/**
 * Handles traditional, parallel tool execution logic.
 */
export class TraditionalToolExecutor {
    private fileLocks: Map<string, Promise<void>> = new Map();

    constructor(
        private readonly agentManager: AgentManager,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly updateConversationHistory: (message: Message) => void,
        private readonly triggerFollowUpMessage: (message?: string) => Promise<void>
    ) { }

    public async execute(toolCalls: ToolCall[], messageId: string, context: ChatViewContext): Promise<void> {
        try {
            log.info(`[PARALLEL] Handling ${toolCalls.length} tool calls in parallel`);
            const startTime = Date.now();

            await this.createCheckpointIfNeeded(toolCalls, messageId, context);

            const { validToolCalls, invalidToolCalls } = ToolCallUtils.validateAndRepairToolCalls(toolCalls);

            if (invalidToolCalls.length > 0) {
                await this.handleInvalidToolCalls(invalidToolCalls, toolCalls, context);
                if (validToolCalls.length === 0) return;
            }

            const results = await this.executeToolCallsParallel(validToolCalls);

            results.forEach(({ toolCall, result }) => {
                this.updateConversationHistory({
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    timestamp: Date.now(),
                    role: 'tool',
                    content: JSON.stringify(result),
                    tool_call_id: toolCall.id,
                });
            });

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

    private async handleInvalidToolCalls(invalidToolCalls: { toolCall: ToolCall, index: number, error: string }[], allToolCalls: ToolCall[], context: ChatViewContext): Promise<void> {
        if (invalidToolCalls.length === allToolCalls.length) {
            let errorMessage = '❌ All tool calls have invalid JSON arguments:\n\n';
            invalidToolCalls.forEach(({ toolCall, index, error }) => {
                errorMessage += `Tool ${index + 1} (${toolCall.function?.name || 'unknown'}):\n${error}\n\n`;
            });
            this.sendMessageToWebview({ type: 'error', message: 'KI hat ungültige JSON-Argumente generiert.' });
            this.updateConversationHistory({ id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), role: 'user', content: errorMessage });
            await this.triggerFollowUpMessage(errorMessage);
        }
    }

    private async executeToolCallsParallel(toolCalls: ToolCall[]): Promise<{ toolCall: ToolCall, result: any, success: boolean }[]> {
        const baseTimestamp = Date.now();
        const taskIds = toolCalls.map((_, i) => `task-${baseTimestamp}-${i}`);
        const planningManager = this.agentManager.getPlanningManager();

        return await Promise.all(toolCalls.map(async (toolCall, i) => {
            const toolName = toolCall.function.name;
            const toolArgs = ToolCallUtils.repairAndParseJSON(toolCall.function.arguments).repaired;
            const taskId = taskIds[i];

            this.sendMessageToWebview({ type: 'taskStart', taskId, taskName: ToolCallUtils.getThinkingMessage(toolName, toolArgs) });

            const targetPlanId = toolArgs.planId || planningManager.getCurrentPlan()?.id;
            let resolvedStep: PlanStep | null = null;

            if (targetPlanId) {
                const plan = planningManager.getPlan(targetPlanId);
                if (plan && (plan.status === 'executing' || plan.status === 'pending')) {
                    resolvedStep = toolArgs.stepId ? plan.steps.find((s: PlanStep) => s.id === toolArgs.stepId) || null : plan.steps.find((s: PlanStep) => s.tool === toolName && (s.status === 'in-progress' || s.status === 'pending')) || null;
                    if (resolvedStep) {
                        toolArgs.planId = targetPlanId;
                        toolArgs.stepId = resolvedStep.id;
                        planningManager.updateStepStatus(targetPlanId, resolvedStep.id, 'in-progress');
                    }
                }
            }

            return await this.executeWithLock(toolName, toolArgs, taskId, targetPlanId, resolvedStep, toolCall, planningManager);
        }));
    }

    private async executeWithLock(toolName: string, toolArgs: any, taskId: string, targetPlanId: string | null, resolvedStep: PlanStep | null, toolCall: ToolCall, planningManager: PlanningManager): Promise<{ toolCall: ToolCall, result: any, success: boolean }> {
        const filePath = toolArgs.path || toolArgs.file_path;
        if (['write_file', 'edit_file', 'safe_edit_file', 'apply_block_edit', 'delete_file'].includes(toolName) && filePath) {
            const currentLock = this.fileLocks.get(filePath) || Promise.resolve();
            const newLock = currentLock.then(() => this.internalExecute(toolName, toolArgs, taskId, targetPlanId, resolvedStep, toolCall, planningManager));
            this.fileLocks.set(filePath, newLock.then(() => { }));
            return await newLock;
        }
        return await this.internalExecute(toolName, toolArgs, taskId, targetPlanId, resolvedStep, toolCall, planningManager);
    }

    private async internalExecute(toolName: string, toolArgs: any, taskId: string, targetPlanId: string | null, resolvedStep: PlanStep | null, toolCall: ToolCall, planningManager: PlanningManager): Promise<{ toolCall: ToolCall, result: any, success: boolean }> {
        try {
            this.sendMessageToWebview({ type: 'taskUpdate', taskId, status: 'active' });
            const result = await this.agentManager.executeTool(toolName, toolArgs);

            if (targetPlanId && resolvedStep) {
                planningManager.updateStepStatus(targetPlanId, resolvedStep.id, 'completed', result);
                this.sendMessageToWebview({ type: 'planStepCompleted', planId: targetPlanId, stepId: resolvedStep.id, result });
            }

            this.sendMessageToWebview({ type: 'taskComplete', taskId });
            this.sendMessageToWebview({ type: 'toolComplete', tool: toolName, comment: ToolCallUtils.generateToolCompletionComment(toolName, toolArgs, result) });

            return { toolCall, result, success: true };
        } catch (error) {
            if (targetPlanId && resolvedStep) {
                planningManager.updateStepStatus(targetPlanId, resolvedStep.id, 'failed', undefined, String(error));
            }
            this.sendMessageToWebview({ type: 'taskComplete', taskId });
            return { toolCall, result: { error: String(error) }, success: false };
        }
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
                const goal = repairResult.repaired.goal;
                const mockProvider = {
                    sendMessage: async () => ({
                        thought_process: `Executing iterative plan for: ${goal}`,
                        status: "in_progress",
                        step: { id: 1, description: "Executing first step", tool: repairResult.repaired.steps?.[0]?.tool || 'apply_block_edit', parameters: repairResult.repaired.steps?.[0]?.parameters || {} }
                    })
                };

                const executionContext = await (this.agentManager as any).executeGoalIteratively(goal, new Map(), mockProvider);
                this.sendMessageToWebview({ type: 'iterativePlanCompleted', goal, totalSteps: executionContext.completed_steps.length, totalTime: executionContext.total_execution_time });

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
        triggerFollowUpMessage: (message?: string) => Promise<void>
    ) {
        this.traditional = new TraditionalToolExecutor(agentManager, sendMessageToWebview, updateConversationHistory, triggerFollowUpMessage);
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
        triggerFollowUpMessage: (message?: string) => Promise<void>
    ) { 
        this.executionHandler = new ToolExecutionHandler(
            agentManager, 
            sendMessageToWebview, 
            updateConversationHistory, 
            triggerFollowUpMessage
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
