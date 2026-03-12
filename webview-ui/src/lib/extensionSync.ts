/**
 * Extension Sync Service
 * 
 * Centralized communication layer between Svelte stores and the VS Code extension.
 * All stores route their backend sync through this service instead of calling
 * vscodeApi.postMessage() directly. Provides debouncing and batching.
 */

import { vscodeApi } from './vscode';

type MessagePayload = Record<string, unknown>;

interface QueuedMessage {
    type: string;
    payload: MessagePayload;
    timestamp: number;
}

// Debounce timers per message type
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Batch queue
let batchQueue: QueuedMessage[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_INTERVAL = 100; // ms
const DEBOUNCE_DELAY = 300; // ms

/**
 * Send a message to the extension immediately (no delay).
 * Use for user-initiated actions that need instant response.
 */
function send(type: string, payload: MessagePayload = {}): void {
    vscodeApi.postMessage({ type, ...payload });
}

/**
 * Send a message with debouncing (300ms default).
 * If the same message type is sent again within the delay, the previous one is cancelled.
 * Use for rapid state changes like typing, toggling, or drag operations.
 */
function sendDebounced(type: string, payload: MessagePayload = {}, delay = DEBOUNCE_DELAY): void {
    const existing = debounceTimers.get(type);
    if (existing) {
        clearTimeout(existing);
    }
    debounceTimers.set(type, setTimeout(() => {
        vscodeApi.postMessage({ type, ...payload });
        debounceTimers.delete(type);
    }, delay));
}

/**
 * Queue a message for batched sending (flushed every 100ms).
 * Use for high-frequency updates like terminal output or streaming chunks.
 */
function sendBatched(type: string, payload: MessagePayload = {}): void {
    batchQueue.push({ type, payload, timestamp: Date.now() });

    if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, BATCH_INTERVAL);
    }
}

/**
 * Flush all queued batch messages.
 */
function flushBatch(): void {
    if (batchQueue.length === 0) {
        batchTimer = null;
        return;
    }

    // Group by type and send the latest payload per type
    const latest = new Map<string, MessagePayload>();
    for (const msg of batchQueue) {
        latest.set(msg.type, msg.payload);
    }

    for (const [type, payload] of latest) {
        vscodeApi.postMessage({ type, ...payload });
    }

    batchQueue = [];
    batchTimer = null;
}

/**
 * Persist a setting to both localStorage and the extension.
 * Convenience wrapper for settings that need dual persistence.
 */
function persistSetting(key: string, value: string): void {
    localStorage.setItem(`gently.${key}`, value);
    send('settingChanged', { key, value });
}

/**
 * Load a setting from localStorage.
 */
function loadSetting(key: string): string | null {
    return localStorage.getItem(`gently.${key}`);
}

/**
 * Cancel all pending debounced and batched messages.
 * Call on dispose / unmount.
 */
function dispose(): void {
    for (const timer of debounceTimers.values()) {
        clearTimeout(timer);
    }
    debounceTimers.clear();

    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
    batchQueue = [];
}

export const extensionSync = {
    send,
    sendDebounced,
    sendBatched,
    persistSetting,
    loadSetting,
    dispose,
};
