import * as vscode from 'vscode';
import { ChatViewContext, Message } from '../types/ChatTypes';
import { ToolCallManager } from '../toolcall';
import { LogService } from '../../../services/LogService';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';
import { ExecutionPlan } from '../../../agent/planning/types';

interface PlanEvent {
    type: string;
    plan?: ExecutionPlan;
    status?: string;
    [key: string]: any; // Kept for event flexibility but better than plain any
}

const log = new LogService('SequenceManagers');

/**
 * Handles Architect Mode specific events and handover logic.
 */
export class ArchitectHandoverHandler {
    constructor(
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void
    ) { }

    public handlePlanEvent(event: PlanEvent, context: ChatViewContext): void {
        // Step/Plan status events — ALWAYS forward to webview (all modes!)
        // These are needed for the TaskView UI to mark steps as completed.
        switch (event.type) {
            case 'planCardCreated':
                this.sendMessageToWebview({
                    type: 'planCardCreated',
                    plan: event.plan,
                    timestamp: event.timestamp || Date.now()
                } as any);
                return;

            case 'planCardUpdated':
                this.sendMessageToWebview({
                    type: 'planCardUpdated',
                    plan: event.plan,
                    timestamp: event.timestamp || Date.now()
                } as any);
                return;

            case 'stepStatusUpdate':
                this.sendMessageToWebview({
                    type: 'stepStatusUpdate',
                    planId: event.planId,
                    stepId: event.stepId,
                    status: event.status,
                    result: event.result,
                    error: event.error
                } as any);
                return;

            case 'planStatusUpdate':
                this.sendMessageToWebview({
                    type: 'planStatusUpdate',
                    planId: event.planId,
                    status: event.status
                } as any);
                return;

            case 'planStepCompleted':
                this.sendMessageToWebview({
                    type: 'stepStatusUpdate',
                    planId: event.planId,
                    stepId: event.stepId,
                    status: 'completed',
                    result: event.result
                } as any);
                return;

            case 'iterativePlanCompleted':
                this.sendMessageToWebview({
                    type: 'iterativePlanCompleted',
                    goal: event.goal,
                    totalSteps: event.totalSteps,
                    totalTime: event.totalTime
                } as any);
                // Reset activity label
                this.sendMessageToWebview({
                    type: 'activityUpdate',
                    label: null
                } as any);
                return;
        }

        // Architect-only events below
        if (context.selectedMode !== 'architect') return;

        switch (event.type) {
            case 'planApprovalRequested':
                this.sendMessageToWebview({
                    type: 'planApprovalRequested',
                    planId: event.planId,
                    approvalRequestId: event.approvalRequestId,
                    goal: event.goal,
                    stepsCount: event.totalSteps || event.stepsCount || 0,
                    timeoutMs: event.timeoutMs,
                    expiresAt: event.expiresAt,
                    timestamp: event.timestamp || Date.now()
                } as any);
                break;

            case 'planApprovalResolved':
                this.sendMessageToWebview({
                    type: 'planApprovalResolved',
                    planId: event.planId,
                    status: event.status,
                    reason: event.reason,
                    reasonCode: event.reasonCode,
                    resolution: event.resolution,
                    approvalRequestId: event.approvalRequestId,
                    expectedApprovalRequestId: event.expectedApprovalRequestId,
                    source: event.source || 'system',
                    timestamp: event.timestamp || Date.now()
                } as any);
                break;
        }
    }

    public getArchitectModeReminder(): string {
        return '\n\n⚠️ ARCHITECT MODE TOOLS REMINDER:\n' +
            'You are the Architect. Use your tools to analyze, plan, and persist decisions.\n' +
            '- create_plan: Create the implementation roadmap.\n' +
            '- planApprovalResponse (user): Approve/reject the plan directly in chat cards.\n' +
            '- ask_question: Offer handover/refinement options with optional mode switch.\n' +
            '- update_memory_bank: Persist architectural decisions.\n' +
            '- handover_to_coder: Trigger Architect -> Code handover after approval.\n' +
            'Do NOT implement code changes yourself.';
    }
}

/**
 * Handles validation and repair of message sequences.
 */
export class MessageSequenceHandler {
    constructor(private readonly toolCallManager: ToolCallManager) { }

    validateSequence(history: Message[]): { valid: boolean; issues: string[] } {
        const issues: string[] = [];
        for (let i = 0; i < history.length; i++) {
            const msg = history[i];
            if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                const toolCallIds = msg.tool_calls.map((tc: any) => tc.id);
                const nextMessages = history.slice(i + 1);
                for (const toolCallId of toolCallIds) {
                    const hasToolMessage = nextMessages.some(nextMsg =>
                        nextMsg.role === 'tool' && nextMsg.tool_call_id === toolCallId
                    );
                    if (!hasToolMessage) issues.push(`Missing tool message for tool_call_id: ${toolCallId}`);
                }
            }
            if (msg.role === 'tool' && msg.tool_call_id) {
                const previousMessages = history.slice(0, i);
                const hasAssistantMessage = previousMessages.some(prevMsg =>
                    prevMsg.role === 'assistant' &&
                    prevMsg.tool_calls &&
                    prevMsg.tool_calls.some((tc: any) => tc.id === msg.tool_call_id)
                );
                if (!hasAssistantMessage) issues.push(`Orphaned tool message for tool_call_id: ${msg.tool_call_id}`);
            }
        }
        return { valid: issues.length === 0, issues };
    }

    repairSequence(history: Message[]): Message[] {
        try {
            const toolCallIds = new Set<string>();
            history.forEach(msg => {
                if (msg.role === 'assistant' && msg.tool_calls) {
                    msg.tool_calls.forEach((tc: any) => toolCallIds.add(tc.id));
                }
            });

            const filteredHistory = history.filter(msg => {
                if (msg.role === 'tool' && msg.tool_call_id) return toolCallIds.has(msg.tool_call_id);
                return true;
            });

            const repairedHistory = [...filteredHistory];
            const existingToolMessages = new Set(
                filteredHistory.filter(msg => msg.role === 'tool' && msg.tool_call_id).map(msg => msg.tool_call_id)
            );

            toolCallIds.forEach(toolCallId => {
                if (!existingToolMessages.has(toolCallId)) {
                    // In the new architecture, we expect the executor to have added these.
                    // If missing, we add a placeholder to keep the sequence valid.
                    repairedHistory.push({
                        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        timestamp: Date.now(),
                        role: 'tool',
                        content: JSON.stringify({ error: "Missing tool result in history" }),
                        tool_call_id: toolCallId
                    });
                    log.info(`Added fallback tool message for ${toolCallId}`);
                }
            });
            return repairedHistory;
        } catch (error) {
            log.error('Error repairing sequence:', error);
            return history;
        }
    }
}

/**
 * Handles follow-up messages and continuation loops.
 */
export class FollowUpHandler {
    constructor(
        private toolCallManager: ToolCallManager,
        private sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private validateMessageSequence: (messages: Message[]) => { valid: boolean; issues: string[] },
        private repairMessageSequence: (messages: Message[]) => { repaired: boolean; messages: Message[]; fixes: string[] },
        private generateAndStreamResponse: (message: string, retryCount: number, isFollowUp: boolean) => Promise<void>,
        private recoverSelectedModel?: () => Promise<string | null>
    ) { }

    async sendFollowUpMessage(context: ChatViewContext, message: string): Promise<void> {
        try {
            log.info('Sending follow-up CONTINUATION...');

            let hasToolCalls = false;
            let toolCallIds: string[] = [];

            for (let i = context.conversationHistory.length - 1; i >= 0; i--) {
                const msg = context.conversationHistory[i];
                if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                    hasToolCalls = true;
                    toolCallIds = msg.tool_calls.map((tc: any) => tc.id);
                    break;
                } else if (msg.role === 'tool') {
                    break;
                }
            }

            if (hasToolCalls) {
                const existingToolMessages = context.conversationHistory.filter(
                    msg => msg.role === 'tool' && msg.tool_call_id && toolCallIds.includes(msg.tool_call_id)
                );

                for (const toolCallId of toolCallIds) {
                    if (!existingToolMessages.some(msg => msg.tool_call_id === toolCallId)) {
                        const toolMessage: Message = {
                            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            timestamp: Date.now(),
                            role: 'tool',
                            content: JSON.stringify({ error: "Missing tool result" }),
                            tool_call_id: toolCallId
                        };
                        context.conversationHistory.push(toolMessage);
                    }
                }
            }

            if (message && message.trim() !== '' && message !== '...') {
                const followUpMessage: Message = {
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    timestamp: Date.now(),
                    role: 'user',
                    content: message,
                };
                context.conversationHistory.push(followUpMessage);
            }

            const validation = this.validateMessageSequence(context.conversationHistory);
            if (!validation.valid) {
                const repair = this.repairMessageSequence(context.conversationHistory);
                if (!repair.repaired) {
                    this.sendMessageToWebview({ type: 'error', message: 'Message sequence error. Please start a new conversation.' });
                    return;
                }
                context.conversationHistory = repair.messages;
                if (repair.fixes.length > 0) {
                    log.info(`Follow-up sequence repaired: ${repair.fixes.join(', ')}`);
                }
            }

            if (!context.selectedModel && this.recoverSelectedModel) {
                const recovered = await this.recoverSelectedModel();
                if (recovered) {
                    context.selectedModel = recovered;
                    log.info(`[FollowUpHandler] Recovered selected model for follow-up: ${recovered}`);
                }
            }

            if (!context.selectedModel) {
                log.error('[FollowUpHandler] Model lost during tool execution; follow-up aborted.');
                this.sendMessageToWebview({
                    type: 'error',
                    message: 'Model selection was lost. Please re-select a model.'
                });
                return;
            }

            await this.generateAndStreamResponse('', 0, true);
        } catch (error: any) {
            log.error('Error sending follow-up message:', error);
            this.sendMessageToWebview({
                type: 'error',
                message: 'Tool execution completed, but follow-up failed.',
            });
        }
    }
}
