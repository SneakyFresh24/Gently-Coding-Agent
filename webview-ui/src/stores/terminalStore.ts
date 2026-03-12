/**
 * Terminal Store — Manages terminal execution state
 * 
 * Pure state store. No side effects.
 */

import { writable, derived } from 'svelte/store';

export interface ApprovalRequest {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: 'safe' | 'moderate' | 'risky';
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface TerminalExecution {
  commandId: string;
  command: string;
  isRunning: boolean;
  exitCode?: number;
  duration?: number;
  output: Array<{
    type: 'stdout' | 'stderr' | 'status' | 'error';
    text: string;
    timestamp: number;
  }>;
}

export interface QuickPattern {
  name: string;
  icon: string;
  enabled: boolean;
}

interface TerminalState {
  mode: 'manual' | 'smart';
  approvalRequests: ApprovalRequest[];
  activeExecutions: Map<string, TerminalExecution>;
  quickPatterns: QuickPattern[];
}

const initialState: TerminalState = {
  mode: 'manual',
  approvalRequests: [],
  activeExecutions: new Map(),
  quickPatterns: [],
};

function createTerminalStore() {
  const { subscribe, set, update } = writable<TerminalState>(initialState);

  return {
    subscribe,

    /** Set terminal mode */
    setMode(mode: 'manual' | 'smart') {
      update(state => ({ ...state, mode }));
    },

    /** Add approval request */
    addApprovalRequest(request: ApprovalRequest) {
      update(state => ({
        ...state,
        approvalRequests: [...state.approvalRequests, { ...request, status: 'pending' }],
      }));
    },

    /** Update approval request status */
    updateApprovalStatus(commandId: string, status: 'approved' | 'rejected') {
      update(state => ({
        ...state,
        approvalRequests: state.approvalRequests.map(req =>
          req.commandId === commandId ? { ...req, status } : req
        ),
      }));
    },

    /** Remove approval request (cleanup) */
    removeApprovalRequest(commandId: string) {
      update(state => ({
        ...state,
        approvalRequests: state.approvalRequests.filter(req => req.commandId !== commandId),
      }));
    },

    /** Start terminal execution */
    startExecution(commandId: string, command: string) {
      update(state => {
        const newExecutions = new Map(state.activeExecutions);
        newExecutions.set(commandId, {
          commandId, command, isRunning: true, output: [],
        });
        return { ...state, activeExecutions: newExecutions };
      });
    },

    /** Add output to execution */
    addOutput(commandId: string, type: 'stdout' | 'stderr' | 'status' | 'error', text: string) {
      update(state => {
        const execution = state.activeExecutions.get(commandId);
        if (!execution) return state;

        const newExecutions = new Map(state.activeExecutions);
        newExecutions.set(commandId, {
          ...execution,
          output: [...execution.output, { type, text, timestamp: Date.now() }],
        });
        return { ...state, activeExecutions: newExecutions };
      });
    },

    /** Complete execution */
    completeExecution(commandId: string, exitCode: number, duration: number) {
      update(state => {
        const execution = state.activeExecutions.get(commandId);
        if (!execution) return state;

        const newExecutions = new Map(state.activeExecutions);
        newExecutions.set(commandId, {
          ...execution, isRunning: false, exitCode, duration,
        });
        return { ...state, activeExecutions: newExecutions };
      });
    },

    /** Remove execution */
    removeExecution(commandId: string) {
      update(state => {
        const newExecutions = new Map(state.activeExecutions);
        newExecutions.delete(commandId);
        return { ...state, activeExecutions: newExecutions };
      });
    },

    /** Set quick patterns */
    setQuickPatterns(patterns: QuickPattern[]) {
      update(state => ({ ...state, quickPatterns: patterns }));
    },

    /** Toggle quick pattern */
    toggleQuickPattern(name: string, enabled: boolean) {
      update(state => ({
        ...state,
        quickPatterns: state.quickPatterns.map(p =>
          p.name === name ? { ...p, enabled } : p
        ),
      }));
    },

    /** Clear all */
    clear() {
      set(initialState);
    },
  };
}

export const terminalStore = createTerminalStore();

// ── Derived Stores ──────────────────────────────────────────

/** Terminal mode */
export const terminalMode = derived(terminalStore, $s => $s.mode);

/** All approval requests */
export const approvalRequests = derived(terminalStore, $s => $s.approvalRequests);

/** Only pending approvals */
export const pendingApprovals = derived(terminalStore, $s =>
  $s.approvalRequests.filter(req => req.status === 'pending')
);

/** Count of pending approvals */
export const pendingApprovalsCount = derived(terminalStore, $s =>
  $s.approvalRequests.filter(req => req.status === 'pending').length
);

/** Active executions as array */
export const activeExecutions = derived(terminalStore, $s =>
  Array.from($s.activeExecutions.values())
);

/** Count of currently running commands */
export const runningCommandCount = derived(terminalStore, $s => {
  let count = 0;
  for (const exec of $s.activeExecutions.values()) {
    if (exec.isRunning) count++;
  }
  return count;
});

/** Quick patterns */
export const quickPatterns = derived(terminalStore, $s => $s.quickPatterns);
