/**
 * Validation Store — Manages code validation state
 * 
 * Pure state store. No side effects (no setTimeout, no console.log).
 * Auto-dismiss is handled by the component layer, not the store.
 */

import { writable, derived } from 'svelte/store';

export interface ValidationError {
  type: 'syntax' | 'type' | 'lint' | 'semantic';
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  code?: string;
  source?: string;
  suggestion?: string;
}

export interface ValidationState {
  currentFile: string | null;
  status: 'idle' | 'validating' | 'success' | 'error';
  errors: ValidationError[];
  retries: number;
  lastValidation: Date | null;
  duration: number | null;
}

const initialState: ValidationState = {
  currentFile: null,
  status: 'idle',
  errors: [],
  retries: 0,
  lastValidation: null,
  duration: null,
};

function createValidationStore() {
  const { subscribe, set, update } = writable<ValidationState>(initialState);

  return {
    subscribe,

    startValidation(file: string) {
      update(s => ({
        ...s,
        currentFile: file,
        status: 'validating',
        errors: [],
        retries: 0,
        duration: null,
      }));
    },

    updateProgress(attempt: number, errorCount: number) {
      update(s => ({
        ...s,
        retries: attempt,
        errors: errorCount > 0 ? s.errors : [],
      }));
    },

    setSuccess(duration: number) {
      update(s => ({
        ...s,
        status: 'success',
        lastValidation: new Date(),
        duration,
      }));
      // No setTimeout here! Auto-dismiss is handled by the component.
    },

    setError(errors: ValidationError[], duration: number) {
      update(s => ({
        ...s,
        status: 'error',
        errors,
        lastValidation: new Date(),
        duration,
      }));
    },

    /** Dismiss back to idle (called by component timer or user action) */
    dismiss() {
      update(s => {
        if (s.status === 'success') {
          return { ...s, status: 'idle' };
        }
        return s;
      });
    },

    reset() {
      set(initialState);
    },
  };
}

export const validationStore = createValidationStore();

// ── Derived Stores ──────────────────────────────────────────

/** Derived: is validation currently running? (replaces redundant isValidating field) */
export const isValidating = derived(validationStore, $s => $s.status === 'validating');

/** Derived: number of validation errors */
export const validationErrorCount = derived(validationStore, $s => $s.errors.length);

/** Derived: are there any validation errors? */
export const hasValidationErrors = derived(validationStore, $s => $s.errors.length > 0);
