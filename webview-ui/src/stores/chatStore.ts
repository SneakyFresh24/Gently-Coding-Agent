/**
 * Chat Store — Manages chat messages and streaming state
 * 
 * Pure state store. Uses extensionSync for backend communication.
 * Streaming state is derived from currentStreamingMessageId.
 */

import { writable, derived, get } from 'svelte/store';
import { extensionSync } from '../lib/extensionSync';
import { realtimeStore } from './realtimeStore';

export interface ToolFunction {
  name: string;
  arguments: string;
}

export const TOOL_METADATA: Record<string, { icon: string; name: string }> = {
  read_file: { icon: "FileText", name: "Read File" },
  write_file: { icon: "FileEdit", name: "Write File" },
  edit_file: { icon: "Pencil", name: "Edit File" },
  str_replace_editor: { icon: "PencilLine", name: "Smart Edit" },
  list_files: { icon: "Files", name: "List Files" },
  find_files: { icon: "Search", name: "Find Files" },
  get_context: { icon: "Target", name: "Context" },
  search_codebase: { icon: "FileSearch", name: "Search Code" },
  analyze_project_structure: { icon: "Layout", name: "Analyze" },
  execute_command: { icon: "Terminal", name: "Terminal" },
  remember: { icon: "Brain", name: "Remember" },
  recall_memories: { icon: "MessageSquare", name: "Recall" },
  create_plan: { icon: "ClipboardList", name: "Create Plan" },
  execute_plan: { icon: "Play", name: "Execute Plan" },
};

export interface ToolCall {
  id: string;
  type: string;
  function: ToolFunction;
}

export interface FileReference {
  path: string;
  displayName: string;
  content?: string;
  size?: number;
  language?: string;
  diffStats?: { added: number; deleted: number };
}

export interface Checkpoint {
  id: string;
  checkpointNumber: number;
  filesTracked: number;
}

export interface ToolExecution {
  toolName: string;
  isExecuting: boolean;
  startTime: number;
  endTime?: number;
  duration?: number;
  fileName?: string;
  diffStats?: { added: number; deleted: number };
  success?: boolean;
}

export interface CommandApproval {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: 'safe' | 'moderate' | 'risky';
  status: 'pending' | 'approved' | 'rejected';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'command-approval' | 'tool-execution';
  content: string;
  fileReferences?: FileReference[];
  checkpoint?: Checkpoint;
  timestamp: number;
  isStreaming?: boolean;
  isSystemMessage?: boolean;
  commandApproval?: CommandApproval;
  toolExecution?: ToolExecution;
}

interface ChatState {
  messages: Message[];
  currentStreamingMessageId: string | null;
  error: string | null;
}

const initialState: ChatState = {
  messages: [],
  currentStreamingMessageId: null,
  error: null,
};

function createChatStore() {
  const { subscribe, set, update } = writable<ChatState>(initialState);

  return {
    subscribe,

    /** Add a user message */
    addUserMessage(content: string, fileReferences?: FileReference[]) {
      update(state => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id: `msg-${Date.now()}-${Math.random()}`,
            role: 'user',
            content,
            fileReferences,
            timestamp: Date.now(),
          },
        ],
      }));
    },

    /** Start assistant message streaming */
    startAssistantMessage() {
      const messageId = `msg-${Date.now()}-${Math.random()}`;
      update(state => ({
        ...state,
        currentStreamingMessageId: messageId,
        messages: [
          ...state.messages,
          {
            id: messageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
          },
        ],
      }));
      return messageId;
    },

    /** Append chunk to streaming message */
    appendChunk(chunk: string) {
      update(state => {
        if (!state.currentStreamingMessageId) return state;
        return {
          ...state,
          messages: state.messages.map(msg =>
            msg.id === state.currentStreamingMessageId
              ? { ...msg, content: msg.content + chunk }
              : msg
          ),
        };
      });
    },

    /** End assistant message streaming (atomic) */
    endAssistantMessage(backendMessageId?: string) {
      update(state => {
        if (!state.currentStreamingMessageId) return state;

        const streamingMsg = state.messages.find(m => m.id === state.currentStreamingMessageId);

        // Remove empty messages
        if (!streamingMsg || streamingMsg.content.trim() === '') {
          return {
            ...state,
            messages: state.messages.filter(m => m.id !== state.currentStreamingMessageId),
            currentStreamingMessageId: null,
          };
        }

        return {
          ...state,
          messages: state.messages.map(msg =>
            msg.id === state.currentStreamingMessageId
              ? { ...msg, id: backendMessageId || msg.id, isStreaming: false }
              : msg
          ),
          currentStreamingMessageId: null,
        };
      });
    },

    /** Add checkpoint to a message */
    addCheckpoint(messageId: string, checkpoint: Checkpoint) {
      update(state => ({
        ...state,
        messages: state.messages.map(msg =>
          msg.id === messageId ? { ...msg, checkpoint } : msg
        ),
      }));
    },

    /** Add command approval message */
    addCommandApprovalMessage(approval: CommandApproval) {
      update(state => {
        const newMessage: Message = {
          id: approval.commandId,
          role: 'command-approval',
          content: approval.command,
          timestamp: Date.now(),
          commandApproval: approval,
        };

        extensionSync.send('commandApprovalCreated', { message: newMessage });

        return {
          ...state,
          messages: [...state.messages, newMessage],
        };
      });
    },

    /** Restore command approval message (from session, no backend notification) */
    restoreCommandApprovalMessage(id: string, approval: CommandApproval, timestamp: number) {
      update(state => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id,
            role: 'command-approval' as const,
            content: approval.command,
            timestamp,
            commandApproval: approval,
          },
        ],
      }));
    },

    /** Update command approval status */
    updateCommandApprovalStatus(commandId: string, status: 'approved' | 'rejected') {
      update(state => ({
        ...state,
        messages: state.messages.map(msg => {
          if (msg.id === commandId && msg.role === 'command-approval' && msg.commandApproval) {
            const updatedMsg = {
              ...msg,
              commandApproval: { ...msg.commandApproval, status },
            };

            // Optimistically decrease pending approvals count
            const currentCount = get(realtimeStore).pendingApprovalsCount;
            if (currentCount > 0) {
              realtimeStore.setPendingApprovalsCount(currentCount - 1);
            }

            extensionSync.send('commandApprovalUpdated', { message: updatedMsg });
            return updatedMsg;
          }
          return msg;
        }),
      }));
    },

    /** Set error message with auto-dismiss */
    setError(error: string) {
      update(state => ({
        ...state,
        error,
        currentStreamingMessageId: null,
      }));

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        update(state => {
          if (state.error === error) {
            return { ...state, error: null };
          }
          return state;
        });
      }, 10000);
    },

    /** Clear error */
    clearError() {
      update(state => ({ ...state, error: null }));
    },

    /** Clear all messages */
    clearMessages() {
      set(initialState);
    },

    /** Set generating state (called by ChatView on generatingStart/End) */
    setGenerating(_isGenerating: boolean) {
      // No-op: isGenerating is now derived from currentStreamingMessageId.
      // Kept for backward compatibility with ChatView.svelte routing.
    },

    /** Add system message */
    addSystemMessage(content: string) {
      const messageId = `msg-${Date.now()}-${Math.random()}`;
      update(state => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id: messageId,
            role: 'system',
            content,
            timestamp: Date.now(),
            isSystemMessage: true,
          },
        ],
      }));

      extensionSync.send('systemMessageCreated', { messageId, content });
    },

    /** Restore system message from session (no backend notification) */
    restoreSystemMessage(id: string, content: string, timestamp: number) {
      update(state => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id,
            role: 'system',
            content,
            timestamp,
            isSystemMessage: true,
          },
        ],
      }));
    },

    /** Restore tool execution message from session */
    restoreToolExecutionMessage(id: string, toolExecution: ToolExecution, timestamp: number) {
      update(state => ({
        ...state,
        messages: [
          ...state.messages,
          {
            id,
            role: 'tool-execution',
            content: toolExecution.toolName,
            timestamp,
            toolExecution,
          },
        ],
      }));
    },

    /** Add a complete (non-streaming) assistant message atomically */
    addFullAssistantMessage(content: string, backendMessageId?: string) {
      const messageId = backendMessageId || `msg-${Date.now()}-${Math.random()}`;
      update(state => {
        // Clean up any residual streaming state
        const messages = state.currentStreamingMessageId
          ? state.messages.filter(m => m.id !== state.currentStreamingMessageId)
          : state.messages;

        return {
          ...state,
          currentStreamingMessageId: null,
          messages: [
            ...messages,
            {
              id: messageId,
              role: 'assistant' as const,
              content,
              timestamp: Date.now(),
              isStreaming: false,
            },
          ],
        };
      });
    },
  };
}

export const chatStore = createChatStore();

// ── Derived Stores ──────────────────────────────────────────

/** Is a message currently being streamed? */
export const isStreaming = derived(chatStore, $s => $s.currentStreamingMessageId !== null);

/** Is the assistant currently generating? (derived, replaces the old field) */
export const isGenerating = derived(chatStore, $s => $s.currentStreamingMessageId !== null);

/** Current streaming message content */
export const streamingContent = derived(chatStore, $s => {
  if (!$s.currentStreamingMessageId) return null;
  const msg = $s.messages.find(m => m.id === $s.currentStreamingMessageId);
  return msg?.content ?? null;
});

/** Last message */
export const lastMessage = derived(chatStore, $s => $s.messages[$s.messages.length - 1]);

/** Message count */
export const messageCount = derived(chatStore, $s => $s.messages.length);
