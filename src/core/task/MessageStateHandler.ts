import { EventEmitter } from 'events';
import { TaskState } from './TaskState';
import {
    PlanApprovalRequestState,
    PlanApprovalResolution,
    PlanEvent,
    TaskStatus
} from '../../agent/planning/types';
import { OutboundWebviewMessage } from '../../views/chat/types/WebviewMessageTypes';
import { Mutex } from '../state/Mutex';
import { PartialMessageUpdate } from '../streaming/types';
import { ExecutionPlan } from '../../agent/planning';

/**
 * Centrally handles outgoing messages and state synchronization between 
 * the Task execution and the Webview.
 * 
 * Uses an internal Mutex to ensure that state updates and UI notifications 
 * happen in the correct order, even if triggered concurrently.
 */
export class MessageStateHandler extends EventEmitter {
    private readonly mutex = new Mutex();

    constructor(
        private readonly taskState: TaskState,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly updateConversationHistory?: (message: any) => void
    ) {
        super();
    }

    private emitPlanEvent(event: PlanEvent) {
        this.emit('planEvent', event);
        this.emit(event.type, event);
    }

    public async updateStepStatus(planId: string, stepId: string, status: TaskStatus, result?: unknown, error?: string) {
        await this.mutex.runExclusive(async () => {
            await this.taskState.update((state) => {
                if (state.plan && state.plan.id === planId) {
                    const step = state.plan.steps.find(s => s.id === stepId);
                    if (step) {
                        step.status = status;
                        if (result !== undefined) step.result = result;
                        if (error !== undefined) step.error = error;

                        // Update plan counters
                        state.plan.completedSteps = state.plan.steps.filter(s => s.status === 'completed').length;
                        state.plan.failedSteps = state.plan.steps.filter(s => s.status === 'failed').length;
                    }
                }
            });

            const event = {
                type: 'stepStatusUpdate' as const,
                planId,
                stepId,
                status,
                result,
                error
            };

            this.emitPlanEvent(event);

            // Forward to webview
            this.sendMessageToWebview({
                ...event,
                type: 'stepStatusUpdate'
            } as any);

            const currentPlan = this.taskState.getPlan();
            if (currentPlan && currentPlan.id === planId) {
                this.sendMessageToWebview({
                    type: 'planCardUpdated',
                    plan: currentPlan,
                    timestamp: Date.now()
                } as any);
            }
        });
    }

    public async updatePlanStatus(planId: string, status: string) {
        await this.mutex.runExclusive(async () => {
            await this.taskState.update((state) => {
                if (state.plan && state.plan.id === planId) {
                    state.plan.status = status as any;
                }
            });

            const event = {
                type: 'planStatusUpdate' as const,
                planId,
                status: status as any
            };

            this.emitPlanEvent(event);

            this.sendMessageToWebview({
                ...event,
                type: 'planStatusUpdate'
            } as any);

            const currentPlan = this.taskState.getPlan();
            if (currentPlan && currentPlan.id === planId) {
                this.sendMessageToWebview({
                    type: 'planCardUpdated',
                    plan: currentPlan,
                    timestamp: Date.now()
                } as any);
            }
        });
    }

    public async sendTaskProgress(progress: number, label: string) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'taskProgress' as const,
                progress,
                label
            };

            this.emitPlanEvent(event);

            this.sendMessageToWebview({
                ...event,
                type: 'taskProgress'
            } as any);
        });
    }

    public async updatePartialMessage(index: number, updates: PartialMessageUpdate) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'partialMessageUpdate' as const,
                index,
                updates
            };

            // Not strictly a PlanEvent, so we emit it separately or as a generic event
            this.emit('partialMessageUpdate', event);

            this.sendMessageToWebview(event as any);
        });
    }

    public async handoverToCoder(planId: string, message: string) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'handoverProgress' as const,
                planId,
                flowId: null,
                status: 'started' as const,
                detail: message,
                timestamp: Date.now()
            };

            this.emitPlanEvent(event as any);

            this.sendMessageToWebview({
                type: 'handoverProgress',
                flowId: event.flowId,
                status: event.status,
                detail: event.detail,
                timestamp: event.timestamp
            } as any);
        });
    }

    public async announcePlanCreated(plan: ExecutionPlan) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'planCardCreated' as const,
                plan,
                timestamp: Date.now()
            };

            this.emitPlanEvent(event as any);
            this.sendMessageToWebview({
                type: 'planCardCreated',
                plan,
                timestamp: event.timestamp
            } as any);
        });
    }

    public async announcePlanApprovalRequested(plan: ExecutionPlan, pendingApproval: PlanApprovalRequestState) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'planApprovalRequested' as const,
                planId: plan.id,
                approvalRequestId: pendingApproval.approvalRequestId,
                goal: plan.goal,
                stepsCount: plan.steps.length,
                timeoutMs: pendingApproval.timeoutMs,
                expiresAt: pendingApproval.expiresAt,
                timestamp: Date.now()
            };
            this.emitPlanEvent(event as any);
            this.sendMessageToWebview(event as any);
            this.sendMessageToWebview({
                type: 'planCardUpdated',
                plan,
                timestamp: Date.now()
            } as any);
        });
    }

    public async announcePlanApprovalResolved(payload: {
        plan: ExecutionPlan;
        status: 'approved' | 'rejected' | 'timeout';
        reason?: string;
        reasonCode?: string;
        source: 'user' | 'policy' | 'system';
        resolution?: PlanApprovalResolution;
        approvalRequestId?: string;
        expectedApprovalRequestId?: string;
    }) {
        await this.mutex.runExclusive(async () => {
            const event = {
                type: 'planApprovalResolved' as const,
                planId: payload.plan.id,
                status: payload.status,
                reason: payload.reason,
                reasonCode: payload.reasonCode,
                source: payload.source,
                resolution: payload.resolution || 'applied',
                approvalRequestId: payload.approvalRequestId,
                expectedApprovalRequestId: payload.expectedApprovalRequestId,
                timestamp: Date.now()
            };
            this.emitPlanEvent(event as any);
            this.sendMessageToWebview(event as any);
            this.sendMessageToWebview({
                type: 'planCardUpdated',
                plan: payload.plan,
                timestamp: Date.now()
            } as any);
        });
    }

    public async announceHandoverProgress(payload: {
        flowId: string | null;
        status: 'started' | 'completed' | 'aborted';
        detail: string;
    }) {
        await this.mutex.runExclusive(async () => {
            this.sendMessageToWebview({
                type: 'handoverProgress',
                flowId: payload.flowId,
                status: payload.status,
                detail: payload.detail,
                timestamp: Date.now()
            } as any);
        });
    }

    public sendSystemMessage(content: string) {
        // Simple system messages don't necessarily need the mutex 
        // as they don't affect plan state, but for consistency:
        this.sendMessageToWebview({
            type: 'systemMessage',
            messageId: `sys_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            content
        });
    }
}
