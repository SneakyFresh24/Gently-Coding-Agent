import { TaskState } from './TaskState';
import { MessageStateHandler } from './MessageStateHandler';
import { ExecutionPlan, PlanStep, TaskStatus } from '../../agent/planning/types';
import { LogService } from '../../services/LogService';

const log = new LogService('Task');

export interface TaskDependencies {
    toolManager: { executeTool(name: string, args: Record<string, unknown>): Promise<unknown> };
    checkpointManager: { createCheckpointAfterStep(planId: string, stepId: string, result: unknown): Promise<void> } | null;
    persistPlan: (plan: ExecutionPlan) => Promise<void>;
}

/**
 * Orchestrates the execution of a task, managing state protection,
 * retries, and recovery logic.
 */
export class Task {
    private isCancelled: boolean = false;

    constructor(
        private readonly state: TaskState,
        private readonly messageHandler: MessageStateHandler,
        private readonly deps: TaskDependencies
    ) {}

    public async execute(): Promise<void> {
        const plan = this.state.getPlan();
        if (!plan) {
            log.error('No plan found in TaskState');
            return;
        }

        log.info(`Starting execution for plan ${plan.id}`);
        await this.messageHandler.updatePlanStatus(plan.id, 'executing');

        while (!this.isCancelled && this.shouldContinue(plan.id)) {
            const step = this.getNextStep(plan.id);
            if (!step) break;

            await this.executeStep(plan.id, step);
            
            // Persist after each step
            const currentPlan = this.state.getPlan();
            if (currentPlan) {
                await this.deps.persistPlan(currentPlan);
            }
        }

        await this.finalizePlan(plan.id);
    }

    private async executeStep(planId: string, step: PlanStep): Promise<void> {
        log.info(`Executing step ${step.id}: ${step.description}`);
        await this.messageHandler.updateStepStatus(planId, step.id, 'in-progress');

        try {
            const result = await this.deps.toolManager.executeTool(step.tool, step.parameters || {});
            
            await this.state.update((s) => {
                s.consecutiveMistakeCount = 0; // Reset mistakes on success
            });

            await this.messageHandler.updateStepStatus(planId, step.id, 'completed', result);

            if (this.deps.checkpointManager) {
                try {
                    await this.deps.checkpointManager.createCheckpointAfterStep(planId, step.id, result);
                } catch (e) {
                    log.error(`Checkpoint failed for step ${step.id}`, e);
                }
            }
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.error(`Step ${step.id} failed:`, errorMsg);

            await this.handleStepFailure(planId, step, errorMsg);
        }
    }

    private async handleStepFailure(planId: string, step: PlanStep, errorMsg: string): Promise<void> {
        let shouldRetry = false;
        let attempt = 0;
        
        await this.state.update((s) => {
            s.consecutiveMistakeCount++;
            if (s.autoRetryAttempts < 3) {
                s.autoRetryAttempts++;
                attempt = s.autoRetryAttempts;
                shouldRetry = true;
            }
        });
 
        if (shouldRetry) {
            log.info(`Retrying step ${step.id} (Attempt ${attempt}/3)`);
            await this.messageHandler.sendSystemMessage(`Step "${step.description}" failed: ${errorMsg}. Retrying (Attempt ${attempt}/3)...`);
            await this.executeStep(planId, step);
        } else {
            log.error(`Step ${step.id} failed after maximum retries.`);
            await this.messageHandler.sendSystemMessage(`Step "${step.description}" failed after maximum retry attempts: ${errorMsg}`);
            await this.messageHandler.updateStepStatus(planId, step.id, 'failed', undefined, errorMsg);
            await this.messageHandler.updatePlanStatus(planId, 'failed');
        }
    }

    private async finalizePlan(planId: string): Promise<void> {
        const plan = this.state.getPlan();
        if (plan && plan.status === 'executing') {
            const allDone = plan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
            if (allDone) {
                await this.messageHandler.updatePlanStatus(planId, 'completed');
            }
        }
    }

    private shouldContinue(planId: string): boolean {
        const plan = this.state.getPlan();
        if (!plan) return false;
        return plan.status === 'executing' && this.getNextStep(planId) !== null;
    }

    private getNextStep(planId: string): PlanStep | null {
        const plan = this.state.getPlan();
        if (!plan) return null;

        return plan.steps.find(step => {
            if (step.status !== 'pending') return false;
            return step.dependencies?.every(depId => {
                const dep = plan.steps.find(s => s.id === depId);
                return dep?.status === 'completed';
            }) ?? true;
        }) || null;
    }

    public cancel(): void {
        this.isCancelled = true;
    }
}
