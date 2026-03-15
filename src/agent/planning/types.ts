/**
 * Task Planning System Types
 * 
 * Implements Planner-Executor architecture for autonomous task execution
 */

export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  description: string;
  tool: string;
  parameters: Record<string, unknown>;
  status: TaskStatus;
  result?: unknown;
  error?: string;
  dependencies?: string[]; // IDs of steps that must complete first
}

export interface ExecutionPlan {
  id: string;
  goal: string;
  steps: PlanStep[];
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'paused';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
}

export interface PlanExecutionResult {
  success: boolean;
  plan: ExecutionPlan;
  completedSteps: PlanStep[];
  failedStep?: PlanStep;
  error?: string;
}

export interface CreatePlanParams {
  goal: string;
  steps: Array<{
    description: string;
    tool: string;
    parameters: Record<string, unknown>;
    dependencies?: string[];
  }>;
}

export interface ExecutePlanParams {
  planId: string;
  autoRetry?: boolean; // Automatically retry failed steps
  maxRetries?: number; // Maximum retries per step
}

export interface IterativeStepResult {
  id: string;
  description: string;
  result: {
    success: boolean;
    result: unknown; // Safe unknown for raw tool output
    execution_time: number;
    error?: string;
  };
}

export interface TaskProgressEvent {
  type: 'taskProgress';
  progress: number;
  label: string;
}

export interface PlanEvent {
  type: 'stepStatusUpdate' | 'planStatusUpdate' | 'iterativePlanStarted' | 'iterativePlanCompleted' | 'iterativePlanFailed' | 'iterativeStepCompleted' | 'iterativeStepFailed' | 'planCreated' | 'planUpdated' | 'planStepCompleted' | 'handover_to_coder' | 'taskProgress' | 'planLoaded';
  planId?: string;
  goal?: string;
  stepId?: string;
  description?: string;
  status?: TaskStatus | string;
  result?: any;
  error?: string;
  timestamp?: number;
  totalSteps?: number;
  completedSteps?: number;
  totalTime?: number;
  plan?: any;
  message?: string;
  progress?: number;
  label?: string;
}
