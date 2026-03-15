import { TaskState } from './TaskState';
import { PlanEvent, TaskStatus } from '../../agent/planning/types';
import { OutboundWebviewMessage } from '../../views/chat/types/WebviewMessageTypes';

/**
 * Centrally handles outgoing messages and state synchronization between 
 * the Task execution and the Webview.
 */
export class MessageStateHandler {
    private listeners: Set<(event: PlanEvent) => void> = new Set();

    constructor(
        private readonly taskState: TaskState,
        private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
        private readonly updateConversationHistory?: (message: any) => void
    ) {}

    public addListener(listener: (event: PlanEvent) => void): void {
        this.listeners.add(listener);
    }

    public removeListener(listener: (event: PlanEvent) => void): void {
        this.listeners.delete(listener);
    }

    private emit(event: PlanEvent): void {
        this.listeners.forEach(l => l(event));
    }

    public async updateStepStatus(planId: string, stepId: string, status: TaskStatus, result?: unknown, error?: string) {
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

        this.emit(event);

        // Forward to webview
        this.sendMessageToWebview({
            ...event,
            type: 'stepStatusUpdate'
        } as any);
    }

    public async updatePlanStatus(planId: string, status: string) {
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

        this.emit(event);

        this.sendMessageToWebview({
            ...event,
            type: 'planStatusUpdate'
        } as any);
    }

    public sendTaskProgress(progress: number, label: string) {
        const event = {
            type: 'taskProgress' as const,
            progress,
            label
        };

        this.emit(event);

        this.sendMessageToWebview({
            ...event,
            type: 'taskProgress'
        } as any);
    }

    public handoverToCoder(planId: string, message: string) {
        const event = {
            type: 'handover_to_coder' as const,
            planId,
            message,
            timestamp: Date.now()
        };

        this.emit(event);

        this.sendMessageToWebview({
            ...event,
            type: 'handover_to_coder'
        } as any);
    }

    public sendSystemMessage(content: string) {
        this.sendMessageToWebview({
            type: 'systemMessage',
            content
        });
    }
}
