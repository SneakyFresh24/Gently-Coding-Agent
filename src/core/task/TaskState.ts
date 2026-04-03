import { ExecutionPlan, TaskStatus, PlanStep } from '../../agent/planning/types';
import { Mutex } from '../state/Mutex';

export interface TaskStateData {
    plan: ExecutionPlan | null;
    toolUseIdMap: Record<string, string>; // tool_name -> tool_use_id
    consecutiveMistakeCount: number;
    autoRetryAttempts: number;
    didAutomaticallyRetryFailedApiRequest: boolean;
    activeHookExecution: any | null;
}

/**
 * Manages the centralized state for a task.
 * Protected by a Mutex to prevent race conditions.
 */
export class TaskState {
    private data: TaskStateData;
    private mutex: Mutex;

    constructor(initialPlan: ExecutionPlan | null = null) {
        this.mutex = new Mutex();
        this.data = {
            plan: initialPlan,
            toolUseIdMap: {},
            consecutiveMistakeCount: 0,
            autoRetryAttempts: 0,
            didAutomaticallyRetryFailedApiRequest: false,
            activeHookExecution: null
        };
    }

    public async update(updater: (state: TaskStateData) => void): Promise<void> {
        await this.mutex.runExclusive(() => {
            updater(this.data);
        });
    }

    public getState(): TaskStateData {
        // Return a copy to prevent accidental mutation outside the mutex
        return JSON.parse(JSON.stringify(this.data));
    }

    public getPlan(): ExecutionPlan | null {
        return this.data.plan;
    }

    public setPlan(plan: ExecutionPlan | null): void {
        this.data.plan = plan;
    }

    public getStep(stepId: string): PlanStep | undefined {
        return this.data.plan?.steps.find(s => s.id === stepId);
    }
}
