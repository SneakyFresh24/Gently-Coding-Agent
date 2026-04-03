// =====================================================
// Extension Store – Global extension state
// =====================================================

import { writable, derived, get } from 'svelte/store';
import { messaging } from '../lib/messaging';
import type {
  ExtensionState,
  AutoApprovalSettings,
  ApiConfiguration,
  Task,
  TaskHistoryItem,
  DEFAULT_AUTO_APPROVAL_SETTINGS,
  PendingApproval,
  ToolCallInfo,
} from '../lib/types';


// ── Store State ──────────────────────────────────────

interface StoreState {
  apiConfiguration: ApiConfiguration | null;
  selectedModel: string;
  taskHistory: TaskHistoryItem[];
  currentTask: Task | null;
  autoApprovalSettings: AutoApprovalSettings;
  mode: ExtensionState['mode'];
  isStreaming: boolean;
  isProcessing: boolean;
  pendingApproval: PendingApproval | null;
  approvalOverlayFallbackEnabled: boolean;
  activityLabel: string | null;
  activityPhase: 'idle' | 'sending' | 'thinking' | 'tooling';
  activeToolCalls: ToolCallInfo[];
}

const TOOL_TIMEOUT_MS = 30_000;

const initialState: StoreState = {
  apiConfiguration: null,
  selectedModel: '',
  taskHistory: [],
  currentTask: null,
  autoApprovalSettings: {
    version: 0,
    actions: {
      readFiles: false,
      readFilesExternally: false,
      editFiles: false,
      editFilesExternally: false,
      executeSafeCommands: false,
      executeAllCommands: false,
      useBrowser: false,
      useMcp: false,
    },
    enableNotifications: true,
    yoloMode: false,
  },
  mode: 'code',
  isStreaming: false,
  isProcessing: false,
  pendingApproval: null,
  approvalOverlayFallbackEnabled: false,
  activityLabel: null,
  activityPhase: 'idle',
  activeToolCalls: [],
};


// ── Store Creation ───────────────────────────────────

function createExtensionStore() {
  const { subscribe, set, update } = writable<StoreState>(initialState);

  return {
    subscribe,

    /** Bulk hydration from backend stateUpdate */
    hydrate(state: Partial<StoreState>) {
      update(s => ({ ...s, ...state }));
    },

    /** Update auto-approval settings and notify backend */
    updateAutoApprovalSettings(settings: Partial<AutoApprovalSettings>) {
      update(s => {
        const updated = {
          ...s.autoApprovalSettings,
          ...settings,
          version: s.autoApprovalSettings.version + 1,
        };
        return { ...s, autoApprovalSettings: updated };
      });
      const current = get({ subscribe });
      messaging.send('setAutoApproveSettings', {
        settings: current.autoApprovalSettings,
      });
    },

    /** Change mode and notify backend */
    setMode(mode: ExtensionState['mode']) {
      update(s => ({ ...s, mode }));
      messaging.send('setMode', { modeId: mode });
    },

    setStreaming(isStreaming: boolean) {
      update(s => ({ ...s, isStreaming }));
    },

    setProcessing(isProcessing: boolean) {
      update(s => ({ ...s, isProcessing }));
    },

    setActivityLabel(activityLabel: string | null) {
      update(s => ({ ...s, activityLabel }));
    },

    setActivityPhase(activityPhase: 'idle' | 'sending' | 'thinking' | 'tooling') {
      update(s => ({ ...s, activityPhase }));
    },

    upsertActiveToolCall(tool: ToolCallInfo) {
      update(s => {
        const now = Date.now();
        const pruned = s.activeToolCalls.filter((t) => now - t.startedAt <= TOOL_TIMEOUT_MS);
        const existingIndex = pruned.findIndex((t) => t.toolId === tool.toolId);
        if (existingIndex >= 0) {
          const next = [...pruned];
          next[existingIndex] = { ...next[existingIndex], ...tool };
          return { ...s, activeToolCalls: next };
        }
        return { ...s, activeToolCalls: [...pruned, tool] };
      });
    },

    removeActiveToolCall(toolId: string) {
      update(s => ({
        ...s,
        activeToolCalls: s.activeToolCalls.filter((t) => t.toolId !== toolId),
      }));
    },

    clearActivityState() {
      update(s => ({
        ...s,
        activityLabel: null,
        activityPhase: 'idle',
        activeToolCalls: [],
      }));
    },

    setCurrentTask(task: Task | null) {
      update(s => ({ ...s, currentTask: task }));
    },

    setApiConfiguration(config: ApiConfiguration | null) {
      update(s => ({ ...s, apiConfiguration: config }));
    },

    setSelectedModel(model: string) {
      update(s => ({ ...s, selectedModel: model }));
      messaging.send('modelChanged', { model });
    },

    setTaskHistory(history: TaskHistoryItem[]) {
      update(s => ({ ...s, taskHistory: history }));
    },

    setPendingApproval(approval: PendingApproval | null) {
      update(s => ({ ...s, pendingApproval: approval }));
    },

    reset() {

      set(initialState);
    },
  };
}

export const extensionStore = createExtensionStore();

// ── Derived Stores ───────────────────────────────────

export const isBusy = derived(
  extensionStore,
  $s => $s.isStreaming || $s.isProcessing
);

export const hasTask = derived(
  extensionStore,
  $s => $s.currentTask !== null
);

export const currentMode = derived(
  extensionStore,
  $s => $s.mode
);

export const hasActiveToolCalls = derived(
  extensionStore,
  $s => $s.activeToolCalls.length > 0
);
