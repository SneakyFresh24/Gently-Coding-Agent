import { PlanStateManager } from './PlanStateManager';
import { PlanValidator } from './PlanValidator';
import { PlanPersistenceService } from './PlanPersistenceService';
import { PlanStep, IterativeStepResult, PlanEvent } from './types';
import { LogService } from '../../services/LogService';
import { AgentTool } from '../agentManager/AgentManager';
import { OpenRouterService } from '../../services/OpenRouterService';

const log = new LogService('PlanExecutionService');

/**
 * Orchestrates the automatic execution of plans.
 */
export class PlanExecutionService {
    private eventCallback?: (event: PlanEvent) => void;

    constructor(
        private state: PlanStateManager,
        private validator: PlanValidator,
        private persistence: PlanPersistenceService
    ) { }

    setEventCallback(cb: (event: PlanEvent) => void): void {
        this.eventCallback = cb;
    }

    async startAutoExecution(
        planId: string,
        toolManager: { executeTool(name: string, args: Record<string, unknown>): Promise<unknown> },
        checkpointManager: { createCheckpointAfterStep(planId: string, stepId: string, result: unknown): Promise<void> } | null
    ): Promise<void> {
        const plan = this.state.getPlan(planId);
        if (!plan) return;

        this.state.updatePlanStatus(planId, 'executing');
        this.eventCallback?.({ type: 'planStatusUpdate', planId, status: 'executing' });
        log.info(`Starting auto-execution for ${planId}`);

        while (this.isPlanExecutable(planId)) {
            const step = this.getNextStep(planId);
            if (!step) break;

            log.info(`Executing step ${step.id}: ${step.description}`);
            this.state.updateStepStatus(planId, step.id, 'in-progress');
            this.eventCallback?.({ type: 'stepStatusUpdate', planId, stepId: step.id, status: 'in-progress' });

            try {
                const result = await toolManager.executeTool(step.tool, step.parameters || {});
                this.state.updateStepStatus(planId, step.id, 'completed', result);
                this.eventCallback?.({ type: 'stepStatusUpdate', planId, stepId: step.id, status: 'completed', result });

                if (checkpointManager) {
                    try {
                        await checkpointManager.createCheckpointAfterStep(planId, step.id, result);
                    } catch (e) { log.error('Checkpoint failed', e); }
                }
            } catch (error: unknown) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log.error(`Step ${step.id} failed:`, error);
                this.state.updateStepStatus(planId, step.id, 'failed', undefined, errorMsg);
                this.eventCallback?.({ type: 'stepStatusUpdate', planId, stepId: step.id, status: 'failed', error: errorMsg });
                this.state.updatePlanStatus(planId, 'failed');
                this.eventCallback?.({ type: 'planStatusUpdate', planId, status: 'failed' });
                return;
            }

            await this.persistence.persistPlan(plan);
        }

        // Mark plan as completed after all steps finish
        const updatedPlan = this.state.getPlan(planId);
        if (updatedPlan && updatedPlan.status === 'executing') {
            const allDone = updatedPlan.steps.every(s => s.status === 'completed' || s.status === 'skipped');
            if (allDone) {
                this.state.updatePlanStatus(planId, 'completed');
                this.eventCallback?.({ type: 'planStatusUpdate', planId, status: 'completed' });
            }
        }

        this.validator.validate(plan);
        await this.persistence.persistPlan(plan);
    }

    private isPlanExecutable(planId: string): boolean {
        const plan = this.state.getPlan(planId);
        if (!plan) return false;
        if (['completed', 'failed', 'paused'].includes(plan.status)) return false;
        return this.getNextStep(planId) !== null;
    }

    public getNextStep(planId: string): PlanStep | null {
        const plan = this.state.getPlan(planId);
        if (!plan) return null;

        return plan.steps.find(step => {
            if (step.status !== 'pending') return false;
            return step.dependencies?.every(depId => {
                const dep = plan.steps.find(s => s.id === depId);
                return dep?.status === 'completed';
            }) ?? true;
        }) || null;
    }

    async executeGoalIteratively(
        goal: string,
        tools: Map<string, AgentTool>,
        provider: OpenRouterService,
        onEvent?: (e: PlanEvent) => void
    ): Promise<{ goal: string; completedSteps: IterativeStepResult[]; totalTime: number }> {
        const emit = (e: PlanEvent) => onEvent?.(e);
        const start = Date.now();
        const completed: IterativeStepResult[] = [];
        let ctx = 'Initial state. No steps have been executed yet.';

        emit({ type: 'iterativePlanStarted', goal, timestamp: start });

        try {
            while (true) {
                const content = await provider.sendMessage([
                    { role: 'system', content: this._iterativeSystemPrompt(tools) },
                    { role: 'user', content: `Goal: ${goal}\n\nContext: ${ctx}\n\nProvide the NEXT single step as JSON with fields: thought_process, step (id, description, tool, parameters), status ("in_progress"|"completed").` }
                ]);

                let iterativePlan: { status: string; step?: { id: string; description: string; tool: string; parameters: Record<string, unknown> } };
                try { iterativePlan = JSON.parse(content); }
                catch { iterativePlan = this._recoverIterativeResponse(content); }

                if (iterativePlan.status === 'completed') {
                    emit({ type: 'iterativePlanCompleted', goal, totalSteps: completed.length, totalTime: Date.now() - start });
                    return { goal, completedSteps: completed, totalTime: Date.now() - start };
                }

                const step = iterativePlan.step;
                if (!step) throw new Error('LLM returned in_progress but no step');

                const tool = tools.get(step.tool);
                if (!tool) throw new Error(`Tool not found: ${step.tool}`);

                const t0 = Date.now();
                try {
                    const result = await tool.execute(step.parameters ?? {});
                    ctx = `Step ${step.id} ('${step.description}') succeeded. Result: ${JSON.stringify(result)}`;
                    completed.push({ id: step.id, description: step.description, result: { success: true, result, execution_time: Date.now() - t0 } });
                    emit({ type: 'iterativeStepCompleted', stepId: step.id, description: step.description });
                } catch (err: unknown) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    emit({ type: 'iterativeStepFailed', stepId: step.id, error: errorMsg });
                    break;
                }
            }
        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            emit({ type: 'iterativePlanFailed', goal, error: errorMsg });
            throw err;
        }

        return { goal, completedSteps: completed, totalTime: Date.now() - start };
    }

    private _iterativeSystemPrompt(tools: Map<string, AgentTool>): string {
        const list = Array.from(tools.values()).map((t: AgentTool) => `- ${t.name}: ${t.description}`).join('\n');
        return `You are Gently, an iterative coding agent. Always respond with valid JSON.\n\nAvailable tools:\n${list}`;
    }

    private _recoverIterativeResponse(content: string): { status: string; step?: { id: string; description: string; tool: string; parameters: Record<string, unknown> } } {
        const status = content.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
        if (status === 'completed') return { status: 'completed' };
        const desc = content.match(/"description"\s*:\s*"([^"]+)"/)?.[1];
        const tool = content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1];
        if (!desc || !tool) return { status: 'completed' };
        return { step: { id: '1', description: desc, tool, parameters: {} }, status: 'in_progress' };
    }
}
