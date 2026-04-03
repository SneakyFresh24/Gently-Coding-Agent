/**
 * Task Planning System Types
 * 
 * Implements Planner-Executor architecture for autonomous task execution
 */

export type TaskStatus = 'pending' | 'in_progress' | 'in-progress' | 'completed' | 'failed' | 'skipped';

export type PlanLifecycleStatus =
  | 'draft'
  | 'created'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'handed_over'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'paused'
  // Legacy aliases kept for backward compatibility in restored sessions.
  | 'pending';

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

export interface PlanApprovalRequestState {
  approvalRequestId: string;
  requestedAt: number;
  expiresAt: number;
  timeoutMs: number;
  statusAtRequest: PlanLifecycleStatus;
}

export type PlanApprovalResolution = 'applied' | 'rejected' | 'stale' | 'mismatch';

export interface PlanApprovalResolutionResult {
  resolution: PlanApprovalResolution;
  reasonCode: string;
  planId: string;
  planStatus: PlanLifecycleStatus;
  approvalRequestId?: string;
  expectedApprovalRequestId?: string;
}

export interface ExecutionPlan {
  schemaVersion: number;
  id: string;
  goal: string;
  steps: PlanStep[];
  status: PlanLifecycleStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  currentStepIndex: number;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  pendingApproval?: PlanApprovalRequestState | null;
}

export interface PlanStepStatusUpdate {
  stepId: string;
  status: TaskStatus;
  reason?: string;
  result?: unknown;
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
    id?: string;
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
  type:
    | 'stepStatusUpdate'
    | 'planStatusUpdate'
    | 'iterativePlanStarted'
    | 'iterativePlanCompleted'
    | 'iterativePlanFailed'
    | 'iterativeStepCompleted'
    | 'iterativeStepFailed'
    | 'planUpdated'
    | 'planCardCreated'
    | 'planCardUpdated'
    | 'planApprovalRequested'
    | 'planApprovalResolved'
    | 'planStepCompleted'
    | 'handoverProgress'
    | 'taskProgress'
    | 'planLoaded';
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
  approvalRequestId?: string;
  timeoutMs?: number;
  expiresAt?: number;
  reasonCode?: string;
  resolution?: PlanApprovalResolution;
  expectedApprovalRequestId?: string;
  plan?: any;
  message?: string;
  progress?: number;
  label?: string;
}
