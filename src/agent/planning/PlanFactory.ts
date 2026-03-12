import { ExecutionPlan, PlanStep, CreatePlanParams } from './types';

export class PlanFactory {
    static createPlan(params: CreatePlanParams): ExecutionPlan {
        const planId = `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const steps: PlanStep[] = params.steps.map((s, i) => ({
            id: `step-${i + 1}`,
            description: s.description,
            tool: s.tool,
            parameters: s.parameters,
            status: 'pending',
            dependencies: s.dependencies || []
        }));

        return {
            id: planId,
            goal: params.goal,
            steps,
            status: 'pending',
            createdAt: Date.now(),
            currentStepIndex: 0,
            totalSteps: steps.length,
            completedSteps: 0,
            failedSteps: 0
        };
    }
}
