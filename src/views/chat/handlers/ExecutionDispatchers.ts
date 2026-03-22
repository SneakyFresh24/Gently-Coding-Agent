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

            const { validToolCalls, invalidToolCalls, warnings } = ToolCallUtils.validateAndRepairToolCalls(toolCalls, {
                model: context.selectedModel || undefined
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
        const toolManager = this.agentManager.getToolManager();
        
        const mappedCalls = toolCalls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            params: ToolCallUtils.repairAndParseJSON(tc.function.arguments).repaired
        }));

        const results = await toolManager.executeTools(mappedCalls);

        return results.map(r => {
            const originalCall = toolCalls.find(tc => tc.id === r.id)!;
            return {
                toolCall: originalCall,
                result: r.result,
                success: !r.result.error
            };
        });
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
