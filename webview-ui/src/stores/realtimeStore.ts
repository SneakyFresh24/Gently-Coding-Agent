/**
 * Realtime Activity Store
 * 
 * Centralized store for ALL real-time indicator states.
 * This is the Single Source of Truth for UI activity indicators.
 * Components subscribe here instead of sniffing messages directly.
 */

import { writable, derived } from 'svelte/store';

export interface RealtimeState {
    // Streaming / Generation
    isGenerating: boolean;
    streamingMessageId: string | null;
    // Validation
    validationStatus: 'idle' | 'validating' | 'success' | 'error';
    validationErrorCount: number;
    // Tasks / Plans
    taskRunning: boolean;
    currentPlanId: string | null;
    // Terminal
    terminalActive: boolean;
    // Approvals & Tools
    pendingApprovalsCount: number;
    activeToolCount: number;
    // UI Overlays / Local-to-Global states
    isEnhancing: boolean;
    showEnhanceSuccess: boolean;
    showValidationDialog: boolean;
    pendingCheckpointRevert: { checkpoint: any; messageId: string } | null;
    customActivityLabel: string | null;
}

const initial: RealtimeState = {
    isGenerating: false,
    streamingMessageId: null,
    validationStatus: 'idle',
    validationErrorCount: 0,
    taskRunning: false,
    currentPlanId: null,
    terminalActive: false,
    pendingApprovalsCount: 0,
    activeToolCount: 0,
    isEnhancing: false,
    showEnhanceSuccess: false,
    showValidationDialog: false,
    pendingCheckpointRevert: null,
    customActivityLabel: null,
};

function createRealtimeStore() {
    const { subscribe, update } = writable<RealtimeState>(initial);

    return {
        subscribe,

        // --- Streaming ---
        setGenerating(val: boolean, messageId: string | null = null) {
            update(s => ({ ...s, isGenerating: val, streamingMessageId: val ? (messageId ?? s.streamingMessageId) : null }));
        },

        // --- Validation ---
        setValidationStatus(status: RealtimeState['validationStatus'], errorCount = 0) {
            update(s => ({ ...s, validationStatus: status, validationErrorCount: errorCount }));

            // Auto-dismiss success status after 3 seconds
            if (status === 'success') {
                setTimeout(() => {
                    update(s => {
                        if (s.validationStatus === 'success') {
                            // Also need to sync with the detailed validation store
                            import('./validationStore').then(({ validationStore }) => {
                                validationStore.dismiss();
                            });
                            return { ...s, validationStatus: 'idle' };
                        }
                        return s;
                    });
                }, 3000);
            }
        },

        // --- Tasks ---
        setTaskRunning(val: boolean, planId: string | null = null) {
            update(s => ({ ...s, taskRunning: val, currentPlanId: planId ?? s.currentPlanId }));
        },

        // --- Terminal ---
        setTerminalActive(val: boolean) {
            update(s => ({ ...s, terminalActive: val }));
        },

        // --- Approvals ---
        setPendingApprovalsCount(count: number) {
            update(s => ({ ...s, pendingApprovalsCount: count }));
        },

        // --- Tools ---
        setActiveToolCount(count: number) {
            update(s => ({ ...s, activeToolCount: count }));
        },

        // --- UI State Management ---
        setEnhancing(val: boolean) {
            update(s => ({ ...s, isEnhancing: val }));
        },

        setEnhanceSuccess(val: boolean) {
            update(s => ({ ...s, showEnhanceSuccess: val }));
            if (val) {
                setTimeout(() => {
                    update(s => ({ ...s, showEnhanceSuccess: false }));
                }, 2000);
            }
        },

        setShowValidationDialog(val: boolean) {
            update(s => ({ ...s, showValidationDialog: val }));
        },

        setPendingCheckpointRevert(pending: { checkpoint: any; messageId: string } | null) {
            update(s => ({ ...s, pendingCheckpointRevert: pending }));
        },

        setActivity(label: string | null) {
            update(s => ({ ...s, customActivityLabel: label }));
        },

        // --- Reset ---
        reset() {
            update(() => initial);
        }
    };
}

export const realtimeStore = createRealtimeStore();

// ── Derived Stores ──────────────────────────────────────────

/** True if ANY subsystem is active */
export const isAnyActivity = derived(realtimeStore, $s =>
    $s.isGenerating || $s.validationStatus === 'validating' || $s.taskRunning || $s.terminalActive || $s.customActivityLabel !== null
);

/** Human-readable activity label */
export const activityLabel = derived(realtimeStore, $s => {
    if ($s.customActivityLabel) return $s.customActivityLabel;
    if ($s.isGenerating) return 'Generating response...';
    if ($s.validationStatus === 'validating') return 'Validating code...';
    if ($s.taskRunning) return 'Executing plan...';
    if ($s.terminalActive) return 'Running terminal command...';
    return 'Idle';
});

/** Activity level (light, medium, heavy) based on number of active subsystems */
export const activityLevel = derived(realtimeStore, $s => {
    let count = 0;
    if ($s.isGenerating) count++;
    if ($s.validationStatus === 'validating') count++;
    if ($s.taskRunning) count++;
    if ($s.terminalActive) count++;
    if ($s.customActivityLabel) count++;

    if (count >= 3) return 'heavy';
    if (count >= 2) return 'medium';
    return 'light';
});

/** True if a message is currently being streamed */
export const hasActiveStreaming = derived(realtimeStore, $s => $s.streamingMessageId !== null);

/** True if there are pending command approvals */
export const hasPendingApprovals = derived(realtimeStore, $s => $s.pendingApprovalsCount > 0);

/** True if validation found errors */
export const hasValidationErrors = derived(realtimeStore, $s => $s.validationErrorCount > 0);
