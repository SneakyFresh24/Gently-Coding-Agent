/**
 * Settings Store — Manages app settings and agent mode
 * 
 * Uses extensionSync for backend communication and localStorage persistence.
 */

import { writable } from 'svelte/store';
import { extensionSync } from '../lib/extensionSync';

export type LLMModel = string;

export interface LLMModelInfo {
  id: LLMModel;
  name: string;
  description?: string;
  provider: 'openrouter';
  context_length?: number;
  max_output?: number;
}

export const defaultModels: LLMModelInfo[] = [
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    description: 'Fast, state-of-the-art open model by DeepSeek',
    provider: 'openrouter',
  },
  {
    id: 'deepseek/deepseek-coder',
    name: 'DeepSeek Coder',
    description: 'DeepSeek Coder V2, optimized for coding tasks',
    provider: 'openrouter',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic\'s most intelligent and capable model',
    provider: 'openrouter',
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    description: 'OpenAI\'s fastest and most capable model',
    provider: 'openrouter',
  },
];

export interface AutoApproveSettings {
  readFiles: boolean;
  readFilesExternally: boolean;
  editFiles: boolean;
  editFilesExternally: boolean;
  executeSafeCommands: boolean;
  executeAllCommands: boolean;
  useBrowser: boolean;
  useMcp: boolean;
  yoloMode: boolean;
}

interface SettingsState {
  agentMode: boolean;
  temperature: number;
  maxTokens: number;
  showContextPanel: boolean;
  selectedModel: LLMModel;
  selectedMode: string;
  availableModels: LLMModelInfo[];
  autoApproveSettings: AutoApproveSettings;
}

const initialAutoApproveSettings: AutoApproveSettings = {
  readFiles: true,
  readFilesExternally: false,
  editFiles: false,
  editFilesExternally: false,
  executeSafeCommands: true,
  executeAllCommands: false,
  useBrowser: false,
  useMcp: false,
  yoloMode: false
};

const initialState: SettingsState = {
  agentMode: false,
  temperature: 0.7,
  maxTokens: 16000,
  showContextPanel: false,
  selectedModel: 'deepseek/deepseek-chat',
  selectedMode: 'ask',
  availableModels: defaultModels,
  autoApproveSettings: initialAutoApproveSettings
};

function createSettingsStore() {
  const { subscribe, update } = writable<SettingsState>(initialState);

  return {
    subscribe,

    /** Toggle agent mode */
    toggleAgentMode() {
      update(state => {
        const newAgentMode = !state.agentMode;
        extensionSync.send('toggleAgentMode', { enabled: newAgentMode });
        return { ...state, agentMode: newAgentMode };
      });
    },

    /** Set agent mode */
    setAgentMode(enabled: boolean) {
      update(state => ({ ...state, agentMode: enabled }));
    },

    /** Set temperature */
    setTemperature(temperature: number) {
      update(state => ({ ...state, temperature }));
    },

    /** Toggle context panel */
    toggleContextPanel() {
      update(state => {
        const newShowContextPanel = !state.showContextPanel;
        if (newShowContextPanel) {
          extensionSync.send('requestContextUpdate', {});
        }
        return { ...state, showContextPanel: newShowContextPanel };
      });
    },

    /** Set context panel visibility */
    setContextPanelVisibility(visible: boolean) {
      update(state => ({ ...state, showContextPanel: visible }));
    },

    /** Set selected LLM model */
    setSelectedModel(model: LLMModel) {
      update(state => {
        extensionSync.send('modelChanged', { model });
        extensionSync.persistSetting('selectedModel', model);

        const modelInfo = state.availableModels.find(m => m.id === model);
        let newMaxTokens = state.maxTokens;

        if (modelInfo?.max_output) {
          newMaxTokens = Math.max(4000, Math.min(16384, modelInfo.max_output));
          extensionSync.send('setMaxTokens', { maxTokens: newMaxTokens });
          extensionSync.persistSetting('maxTokens', newMaxTokens.toString());
        }

        return { ...state, selectedModel: model, maxTokens: newMaxTokens };
      });
    },

    /** Set max tokens */
    setMaxTokens(maxTokens: number) {
      update(state => {
        extensionSync.send('setMaxTokens', { maxTokens });
        extensionSync.persistSetting('maxTokens', maxTokens.toString());
        return { ...state, maxTokens };
      });
    },

    /** Set available models */
    setAvailableModels(models: Array<{ id: string; name: string; context_length?: number; max_output?: number }>) {
      update(state => ({
        ...state,
        availableModels: models.map(m => ({
          id: m.id,
          name: m.name,
          description: m.context_length ? `Context: ${m.context_length.toLocaleString()} tokens` : '',
          provider: 'openrouter' as const,
          context_length: m.context_length,
          max_output: m.max_output,
        })),
      }));
    },

    /** Set selected mode */
    setSelectedMode(modeId: string) {
      update(state => {
        extensionSync.send('modeChanged', { modeId });
        extensionSync.persistSetting('selectedMode', modeId);
        return { ...state, selectedMode: modeId };
      });
    },

    /** Set auto-approve settings */
    setAutoApproveSettings(settings: AutoApproveSettings) {
      update(state => {
        extensionSync.send('setAutoApproveSettings', { settings });
        return { ...state, autoApproveSettings: settings };
      });
    },

    /** Toggle YOLO mode */
    toggleYoloMode(enabled: boolean) {
      update(state => {
        extensionSync.send('toggleYoloMode', { enabled });
        return { ...state, autoApproveSettings: { ...state.autoApproveSettings, yoloMode: enabled } };
      });
    },

    /** Update settings from extension */
    updateFromExtension(settings: AutoApproveSettings) {
      update(state => ({ ...state, autoApproveSettings: settings }));
    },

    /** Hydrate all settings from localStorage in a single call */
    hydrate() {
      const savedModel = extensionSync.loadSetting('selectedModel');
      const savedMode = extensionSync.loadSetting('selectedMode');
      const savedMaxTokens = extensionSync.loadSetting('maxTokens');

      update(state => ({
        ...state,
        ...(savedModel && { selectedModel: savedModel }),
        ...(savedMode && { selectedMode: savedMode }),
        ...(savedMaxTokens && { maxTokens: parseInt(savedMaxTokens, 10) }),
      }));
    },
  };
}

export const settingsStore = createSettingsStore();
