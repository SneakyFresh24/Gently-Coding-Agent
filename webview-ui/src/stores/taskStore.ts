/**
 * Task Store — Manages execution plans and task state
 * 
 * Pure state store. Uses extensionSync for backend communication.
 * No direct vscodeApi.postMessage calls.
 */

import { writable, derived, get } from 'svelte/store';
import { extensionSync } from '../lib/extensionSync';

export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'failed' | 'skipped';

export interface PlanStep {
  id: string;
  description: string;
  tool: string;
  status: TaskStatus;
  result?: unknown;
  error?: string;
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

interface TaskState {
  plans: ExecutionPlan[];
  currentPlanId: string | null;
  isLoading: boolean;
  hasError: boolean;
}

const initialState: TaskState = {
  plans: [],
  currentPlanId: null,
  isLoading: false,
  hasError: false,
};

/** Sync current task state to the extension (debounced) */
function syncToExtension(state: TaskState): void {
  extensionSync.sendDebounced('syncTasks', {
    plans: state.plans,
    currentPlanId: state.currentPlanId,
  });
}

function createTaskStore() {
  const { subscribe, set, update } = writable<TaskState>(initialState);

  /** Helper: update + sync in one step */
  function updateAndSync(updater: (state: TaskState) => TaskState): void {
    update(state => {
      const newState = updater(state);
      // We return the state first, but update() is synchronous in Svelte
      // so we can call sync immediately after or use a tick, but simple order reversal is what the user highlighted.
      // Actually, Bug 5 says Sync VOR dem return is the problem.
      setTimeout(() => syncToExtension(newState), 0); 
      return newState;
    });
  }

  return {
    subscribe,

    /** Add a new plan */
    addPlan(plan: ExecutionPlan) {
      updateAndSync(state => ({
        ...state,
        plans: [...state.plans, plan],
        currentPlanId: plan.id,
      }));
    },

    /** Update plan status */
    updatePlanStatus(planId: string, status: ExecutionPlan['status']) {
      updateAndSync(state => ({
        ...state,
        plans: state.plans.map(plan =>
          plan.id === planId ? { ...plan, status } : plan
        ),
      }));
    },

    /** Update step status */
    updateStepStatus(planId: string, stepId: string, status: TaskStatus, result?: unknown, error?: string) {
      updateAndSync(state => ({
        ...state,
        plans: state.plans.map(plan => {
          if (plan.id !== planId) return plan;

          const updatedSteps = plan.steps.map(step => {
            if (step.id !== stepId) return step;
            return {
              ...step,
              status,
              result: result !== undefined ? result : step.result,
              error: error || step.error,
            };
          });

          return {
            ...plan,
            steps: updatedSteps,
            completedSteps: updatedSteps.filter(s => s.status === 'completed').length,
            failedSteps: updatedSteps.filter(s => s.status === 'failed').length,
          };
        }),
      }));
    },

    /** Set current plan */
    setCurrentPlan(planId: string | null) {
      updateAndSync(state => ({ ...state, currentPlanId: planId }));
    },

    /** Clear all plans */
    clearPlans() {
      set(initialState);
      syncToExtension(initialState);
    },

    /** Remove a specific plan */
    removePlan(planId: string) {
      updateAndSync(state => ({
        ...state,
        plans: state.plans.filter(p => p.id !== planId),
        currentPlanId: state.currentPlanId === planId ? null : state.currentPlanId,
      }));
    },

    /** Restore plans from backend session (no sync back) */
    hydrateTasks(plans: ExecutionPlan[], currentPlanId: string | null) {
      set({ plans, currentPlanId, isLoading: false, hasError: false });
    },

    /** Update a single plan from backend (replace if exists, add if new) */
    updatePlan(plan: ExecutionPlan) {
      updateAndSync(state => {
        const exists = state.plans.some(p => p.id === plan.id);
        return {
          ...state,
          plans: exists
            ? state.plans.map(p => p.id === plan.id ? plan : p)
            : [...state.plans, plan],
          currentPlanId: plan.id,
        };
      });
    },

    /** Set loading state */
    setLoading(isLoading: boolean) {
      update(state => ({ ...state, isLoading }));
    },

    /** Set error state */
    setHasError(hasError: boolean) {
      update(state => ({ ...state, hasError, isLoading: false }));
    },

    /** Request current plan from backend */
    requestCurrentPlan() {
      extensionSync.send('requestCurrentPlan', {});
    },
  };
}

export const taskStore = createTaskStore();

// ── Exported Actions (accept planId explicitly instead of using get()) ──

export function retryStep(planId: string, stepId: string): void {
  taskStore.updateStepStatus(planId, stepId, 'pending', undefined, undefined);
  extensionSync.send('retryStep', { planId, stepId });
}

export function skipStep(planId: string, stepId: string): void {
  taskStore.updateStepStatus(planId, stepId, 'completed', undefined, undefined);
  extensionSync.send('skipStep', { planId, stepId });
}

export function abortPlan(planId: string): void {
  taskStore.updatePlanStatus(planId, 'failed');
  extensionSync.send('abortPlan', { planId });
}

export function showStepResult(planId: string, stepId: string, result: string): void {
  extensionSync.send('showStepResult', { planId, stepId, result });
}

// ── Derived Stores ──────────────────────────────────────────

/** Loading state */
export const isLoading = derived(taskStore, $s => $s.isLoading);

/** Error state */
export const hasError = derived(taskStore, $s => $s.hasError);

/** Current plan */
export const currentPlan = derived(taskStore, $s => {
  if (!$s.currentPlanId) return null;
  return $s.plans.find(p => p.id === $s.currentPlanId) || null;
});

/** Plan details with statistics */
export const planDetails = derived(currentPlan, $plan => {
  if (!$plan) return null;
  const completed = $plan.completedSteps;
  const failed = $plan.failedSteps;
  const pending = $plan.steps.filter(s => ['pending', 'in-progress'].includes(s.status)).length;
  const total = $plan.totalSteps;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    completed,
    failed,
    pending,
    total,
    percentage,
    hasErrors: failed > 0,
    isRunning: $plan.status === 'executing',
  };
});
