// =====================================================
// Chat Store – Messages, streaming, and input state
// =====================================================

import { writable, derived, get } from 'svelte/store';
import { messaging } from '../lib/messaging';
import type { Message } from '../lib/types';

// ── Store State ──────────────────────────────────────

interface ChatStoreState {
  messages: Message[];
  inputValue: string;
  selectedFiles: string[];
  streamingMessageId: string | null;
  error: string | null;
}

const initialState: ChatStoreState = {
  messages: [],
  inputValue: '',
  selectedFiles: [],
  streamingMessageId: null,
  error: null,
};

// ── Store Creation ───────────────────────────────────

function createChatStore() {
  const { subscribe, set, update } = writable<ChatStoreState>(initialState);

  return {
    subscribe,

    // ── Messages ─────────────────────────────────────

    /** Add a complete message */
    addMessage(message: Message) {
      update(s => ({
        ...s,
        messages: [...s.messages, message],
        error: null,
      }));
    },

    /** Start streaming a new assistant message */
    startStreaming(messageId: string) {
      const msg: Message = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
      };
      update(s => ({
        ...s,
        messages: [...s.messages, msg],
        streamingMessageId: messageId,
      }));
    },

    /** Append content to the currently streaming message */
    appendChunk(data: { id?: string; messageId?: string; content: string }) {
      const targetId = data.id || data.messageId;
      update(s => {
        // If no streaming message exists, start one
        if (!s.streamingMessageId && targetId) {
          const msg: Message = {
            id: targetId,
            role: 'assistant',
            content: data.content,
            timestamp: Date.now(),
            isStreaming: true,
          };
          return {
            ...s,
            messages: [...s.messages, msg],
            streamingMessageId: targetId,
          };
        }

        return {
          ...s,
          messages: s.messages.map(m => {
            if (m.id === (targetId || s.streamingMessageId)) {
              return { ...m, content: m.content + data.content };
            }
            return m;
          }),
        };
      });
    },

    /** Mark streaming as complete */
    completeStreaming(data?: { messageId?: string }) {
      update(s => ({
        ...s,
        messages: s.messages.map(m => {
          if (m.id === (data?.messageId || s.streamingMessageId)) {
            return { ...m, isStreaming: false };
          }
          return m;
        }),
        streamingMessageId: null,
      }));
    },

    /** Update a specific message by ID */
    updateMessage(messageId: string, updates: Partial<Message>) {
      update(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      }));
    },

    // ── Input ────────────────────────────────────────

    setInputValue(value: string) {
      update(s => ({ ...s, inputValue: value }));
    },

    // ── Files ────────────────────────────────────────

    addFile(path: string) {
      update(s => {
        if (s.selectedFiles.includes(path)) return s;
        return { ...s, selectedFiles: [...s.selectedFiles, path] };
      });
    },

    removeFile(path: string) {
      update(s => ({
        ...s,
        selectedFiles: s.selectedFiles.filter(f => f !== path),
      }));
    },

    clearFiles() {
      update(s => ({ ...s, selectedFiles: [] }));
    },

    // ── Actions ──────────────────────────────────────

    /** Send a message to the backend */
    sendMessage() {
      const state = get({ subscribe });
      if (!state.inputValue.trim() && state.selectedFiles.length === 0) return;

      messaging.send('sendMessage', {
        message: state.inputValue,
        fileReferences: state.selectedFiles.map(path => ({
          path,
          name: path.split(/[/\\]/).pop() || path,
        })),
      });

      update(s => ({
        ...s,
        inputValue: '',
        selectedFiles: [],
      }));
    },

    /** Cancel the current task */
    cancelTask() {
      // Send cancel all to ensure both stream and tools stop
      messaging.send('toolApprovalResponse', { approvalId: 'CANCEL_ALL', approved: false });
      messaging.send('stopMessage');
      // We don't reset streamingMessageId here - let the backend send generatingEnd
    },


    // ── Error ────────────────────────────────────────

    setError(error: string | null) {
      update(s => ({ ...s, error }));
    },

    // ── Lifecycle ────────────────────────────────────

    /** Replace all messages (e.g., session load) */
    hydrateMessages(messages: Message[]) {
      update(s => ({ ...s, messages, streamingMessageId: null }));
    },

    /** Clear everything */
    clear() {
      set(initialState);
    },
  };
}

export const chatStore = createChatStore();

// ── Derived Stores ───────────────────────────────────

export const isStreaming = derived(
  chatStore,
  $s => $s.streamingMessageId !== null
);

export const messageCount = derived(
  chatStore,
  $s => $s.messages.length
);

export const lastMessage = derived(
  chatStore,
  $s => $s.messages[$s.messages.length - 1] ?? null
);
