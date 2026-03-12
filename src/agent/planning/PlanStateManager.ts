import { ExecutionPlan, PlanStep, TaskStatus } from './types';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanStateManager');

/**
 * Manages the state of execution plans (storage and CRUD).
 */
export class PlanStateManager {
    private plans: Map<string, ExecutionPlan> = new Map();
    private currentPlanId: string | null = null;

    getCurrentPlanId(): string | null {
        return this.currentPlanId;
    }

    setCurrentPlanId(planId: string | null): void {
        this.currentPlanId = planId;
        log.info(`Current plan ID set to: ${planId}`);
    }

    addPlan(plan: ExecutionPlan): void {
        this.plans.set(plan.id, plan);
        this.currentPlanId = plan.id;
    }

    getPlan(planId: string): ExecutionPlan | undefined {
        return this.plans.get(planId);
    }

    getAllPlans(): ExecutionPlan[] {
        return Array.from(this.plans.values());
    }

    getCurrentPlan(): ExecutionPlan | undefined {
        return this.currentPlanId ? this.plans.get(this.currentPlanId) : undefined;
    }

    updateStepStatus(planId: string, stepId: string, status: TaskStatus, result?: unknown, error?: string): void {
        const plan = this.plans.get(planId);
        if (!plan) throw new Error(`Plan not found: ${planId}`);

        const step = plan.steps.find(s => s.id === stepId);
        if (!step) throw new Error(`Step not found: ${stepId}`);

        step.status = status;
        if (result !== undefined) step.result = result;
        if (error) step.error = error;

        this.updateStats(plan);
        log.debug(`Plan ${planId}, Step ${stepId} status: ${status}`);
    }

    updatePlanStatus(planId: string, status: ExecutionPlan['status']): void {
        const plan = this.plans.get(planId);
        if (!plan) throw new Error(`Plan not found: ${planId}`);

        plan.status = status;
        if (status === 'executing' && !plan.startedAt) {
            plan.startedAt = Date.now();
        } else if ((status === 'completed' || status === 'failed') && !plan.completedAt) {
            plan.completedAt = Date.now();
        }
        log.info(`Plan ${planId} status: ${status}`);
    }

    clear(): void {
        this.plans.clear();
        this.currentPlanId = null;
    }

    private updateStats(plan: ExecutionPlan): void {
        plan.completedSteps = plan.steps.filter(s => s.status === 'completed').length;
        plan.failedSteps = plan.steps.filter(s => s.status === 'failed').length;
    }
}
