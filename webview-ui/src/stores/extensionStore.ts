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
}

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
  },
  mode: 'code',
  isStreaming: false,
  isProcessing: false,
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
