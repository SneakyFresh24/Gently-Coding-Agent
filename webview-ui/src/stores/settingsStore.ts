// =====================================================
// Settings Store – API key, models, and preferences
// =====================================================

import { writable, derived } from 'svelte/store';
import { messaging } from '../lib/messaging';
import type { ModelInfo } from '../lib/types';

// ── Store State ──────────────────────────────────────

interface SettingsStoreState {
  hasApiKey: boolean;
  availableModels: ModelInfo[];
  maxTokens: number;
  isLoadingModels: boolean;
}

const initialState: SettingsStoreState = {
  hasApiKey: false,
  availableModels: [],
  maxTokens: 8000,
  isLoadingModels: false,
};

// ── Store Creation ───────────────────────────────────

function createSettingsStore() {
  const { subscribe, set, update } = writable<SettingsStoreState>(initialState);

  return {
    subscribe,

    setApiKeyStatus(hasKey: boolean) {
      update(s => ({ ...s, hasApiKey: hasKey }));
    },

    setApiKey(key: string) {
      messaging.send('setApiKey', { key });
    },

    deleteApiKey() {
      messaging.send('deleteApiKey');
    },

    setModels(models: ModelInfo[]) {
      update(s => ({ ...s, availableModels: models, isLoadingModels: false }));
    },

    fetchModels() {
      update(s => ({ ...s, isLoadingModels: true }));
      messaging.send('fetchModels');
    },

    setMaxTokens(maxTokens: number) {
      update(s => ({ ...s, maxTokens }));
      messaging.send('setMaxTokens', { maxTokens });
    },

    reset() {
      set(initialState);
    },
  };
}

export const settingsStore = createSettingsStore();

// ── Derived Stores ───────────────────────────────────

export const hasModels = derived(
  settingsStore,
  $s => $s.availableModels.length > 0
);
