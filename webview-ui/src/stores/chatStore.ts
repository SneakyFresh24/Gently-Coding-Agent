// =====================================================
// Chat Store – Messages, streaming, and input state
// =====================================================

import { writable, derived, get } from 'svelte/store';
import { messaging } from '../lib/messaging';
import type { Message } from '../lib/types';

// ── Store State ──────────────────────────────────────

type UiErrorType = 'rate_limit' | 'network' | 'validation' | 'unknown';

interface UiErrorState {
  type: UiErrorType;
  message: string;
  requestId?: string;
}

interface MentionResult {
  path: string;
  displayName?: string;
  type?: 'file' | 'folder';
}

interface MentionState {
  isOpen: boolean;
  query: string;
  results: MentionResult[];
  activeIndex: number;
  atIndex: number;
  cursorPosition: number;
}

interface TaskProgressState {
  label: string;
  progress: number | null;
  totalCount: number;
  completedCount: number;
  currentIndex: number;
}

interface UiLoadingState {
  isRetrying: boolean;
}

interface ChatStoreState {
  messages: Message[];
  inputValue: string;
  selectedFiles: string[];
  streamingMessageId: string | null;
  error: UiErrorState | null;
  mention: MentionState;
  taskProgress: TaskProgressState | null;
  loading: UiLoadingState;
}

const initialState: ChatStoreState = {
  messages: [],
  inputValue: '',
  selectedFiles: [],
  streamingMessageId: null,
  error: null,
  mention: {
    isOpen: false,
    query: '',
    results: [],
    activeIndex: 0,
    atIndex: -1,
    cursorPosition: 0,
  },
  taskProgress: null,
  loading: {
    isRetrying: false,
  },
};

function parseTodoInfo(text: string): TaskProgressState | null {
  const lines = (text || '').split('\n');
  const matches = lines.filter((line) => /^[-*]\s+\[[ xX]\]/.test(line));
  if (matches.length === 0) return null;

  const completedCount = matches.filter((line) => /\[[xX]\]/.test(line)).length;
  const firstOpenIndex = matches.findIndex((line) => !/\[[xX]\]/.test(line));
  const currentIndex = firstOpenIndex === -1 ? matches.length : firstOpenIndex + 1;
  const progress = matches.length > 0 ? Math.round((completedCount / matches.length) * 100) : 0;

  return {
    label: 'Checklist progress',
    progress,
    totalCount: matches.length,
    completedCount,
    currentIndex,
  };
}

function classifyError(message: string): UiErrorType {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('rate') || normalized.includes('429')) return 'rate_limit';
  if (normalized.includes('network') || normalized.includes('timeout') || normalized.includes('fetch')) return 'network';
  if (normalized.includes('validation') || normalized.includes('invalid')) return 'validation';
  return 'unknown';
}

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
        loading: {
          ...s.loading,
          isRetrying: false,
        },
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

    setMentionContext(atIndex: number, cursorPosition: number, query: string) {
      update((s) => ({
        ...s,
        mention: {
          ...s.mention,
          isOpen: true,
          atIndex,
          cursorPosition,
          query,
          activeIndex: 0,
        },
      }));
    },

    setMentionResults(results: MentionResult[]) {
      update((s) => ({
        ...s,
        mention: {
          ...s.mention,
          isOpen: true,
          results,
          activeIndex: Math.min(s.mention.activeIndex, Math.max(results.length - 1, 0)),
        },
      }));
    },

    setMentionActiveIndex(activeIndex: number) {
      update((s) => ({
        ...s,
        mention: {
          ...s.mention,
          activeIndex,
        },
      }));
    },

    closeMentionMenu() {
      update((s) => ({
        ...s,
        mention: {
          ...s.mention,
          isOpen: false,
          query: '',
          results: [],
          activeIndex: 0,
          atIndex: -1,
        },
      }));
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
        mention: {
          ...s.mention,
          isOpen: false,
          query: '',
          results: [],
          activeIndex: 0,
          atIndex: -1,
        },
      }));
    },

    /** Cancel the current task */
    cancelTask() {
      messaging.send('stopMessage');
      // We don't reset streamingMessageId here - let the backend send generatingEnd
    },


    // ── Error ────────────────────────────────────────

    setError(error: string | null, requestId?: string) {
      update(s => ({
        ...s,
        error: error
          ? {
            type: classifyError(error),
            message: error,
            requestId,
          }
          : null,
        loading: {
          ...s.loading,
          isRetrying: false,
        },
      }));
    },

    clearError() {
      update((s) => ({ ...s, error: null }));
    },

    retryLastMessage() {
      const state = get({ subscribe });
      const messages = [...state.messages].reverse();
      const lastUserMessage = messages.find((msg) => msg.role === 'user');
      if (!lastUserMessage?.content?.trim()) return;

      messaging.send('sendMessage', {
        message: lastUserMessage.content,
        fileReferences: lastUserMessage.fileReferences || [],
      });

      update((s) => ({
        ...s,
        error: null,
      }));
    },

    setRetrying(isRetrying: boolean) {
      update((s) => ({
        ...s,
        loading: {
          ...s.loading,
          isRetrying,
        },
      }));
    },

    updateTaskProgress(payload: { label?: string; progress?: number; text?: string }) {
      update((s) => {
        const parsed = payload.text ? parseTodoInfo(payload.text) : null;
        const fallback = parseTodoInfo(payload.label || '');
        const nextProgress = parsed || fallback || s.taskProgress;
        const normalizedProgress = typeof payload.progress === 'number' ? Math.max(0, Math.min(100, payload.progress)) : (nextProgress?.progress ?? null);

        return {
          ...s,
          taskProgress: {
            label: payload.label || nextProgress?.label || 'Task progress',
            progress: normalizedProgress,
            totalCount: nextProgress?.totalCount || 0,
            completedCount: nextProgress?.completedCount || 0,
            currentIndex: nextProgress?.currentIndex || 0,
          },
        };
      });
    },

    clearTaskProgress() {
      update((s) => ({ ...s, taskProgress: null }));
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

export const mentionState = derived(
  chatStore,
  ($s) => $s.mention
);

export const taskProgressState = derived(
  chatStore,
  ($s) => $s.taskProgress
);
