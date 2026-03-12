/**
 * Context Store — Manages file context and tracked files
 * 
 * Uses extensionSync for backend communication (debounced).
 */

import { writable } from 'svelte/store';
import { extensionSync } from '../lib/extensionSync';

export interface ContextFile {
  path: string;
  score: number;
  lastUsed: number;
  usageCount: number;
  tokenCount: number;
  inContext: boolean;
  pinned: boolean;
  language: string;
  size: number;
}

export interface ContextStats {
  totalFiles: number;
  filesInContext: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercent: number;
}

interface ContextState {
  files: ContextFile[];
  stats: ContextStats | null;
}

const initialState: ContextState = {
  files: [],
  stats: null,
};

function createContextStore() {
  const { subscribe, set, update } = writable<ContextState>(initialState);

  return {
    subscribe,

    /** Update context from extension */
    updateContext(files: ContextFile[], stats: ContextStats) {
      set({ files, stats });
      extensionSync.sendDebounced('syncContext', { files, stats });
    },

    /** Restore context from backend session (no sync back) */
    hydrateContext(files: ContextFile[], stats: ContextStats | null) {
      set({ files, stats });
    },

    /** Clear context */
    clearContext() {
      set(initialState);
    },

    /** Toggle pin for a file (optimistic — UI updates instantly, sync follows) */
    togglePin(filePath: string) {
      update(state => {
        const files = state.files.map(file =>
          file.path === filePath ? { ...file, pinned: !file.pinned } : file
        );
        const newState = { ...state, files };
        // Optimistic: send immediately so backend stays in sync
        extensionSync.send('syncContext', { files: newState.files, stats: newState.stats });
        return newState;
      });
    },
  };
}

export const contextStore = createContextStore();
