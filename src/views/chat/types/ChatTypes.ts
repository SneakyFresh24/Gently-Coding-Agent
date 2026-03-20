// =====================================================
// Chat Types
// =====================================================

import { FileReference } from '../../../agent/fileReferenceManager';
import { ToolCall, ChatMessage } from '../../../services/OpenRouterService';

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
  role: 'user' | 'assistant' | 'system' | 'tool' | 'command-approval' | 'tool-execution';
  content: string;
  fileReferences?: FileReference[];
  toolCalls?: ToolCall[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  checkpoint?: Checkpoint;
  timestamp: number;
  isStreaming?: boolean;
  isSystemMessage?: boolean;
  commandApproval?: CommandApproval;
  toolExecution?: ToolExecution;
}

export interface ChatState {
  messages: Message[];
  isGenerating: boolean;
  currentStreamingMessageId: string | null;
  error: string | null;
}

/**
 * @deprecated Use discriminated union types from WebviewMessageTypes.ts instead
 * This loose type is maintained for backward compatibility only
 */
export interface LegacyWebviewMessage {
  type: string;
  [key: string]: any;
}

export type { WebviewMessage, InboundWebviewMessage, OutboundWebviewMessage } from './WebviewMessageTypes';

export interface ChatViewContext {
  agentMode: boolean;
  selectedModel: string;
  selectedMode: string;
  conversationHistory: Message[];
  shouldStopStream: boolean;
  shouldAbortTools?: boolean;
  currentFlowId?: string;
  currentMessageId?: string;
  messageCheckpoints: Map<string, string>;
  toolExecutionStartSent: Set<string>;
  conversationSummary?: string;
}

/**
 * Convert internal Message to format for model interaction
 */
export function toChatMessage(message: Message): ChatMessage {
  return {
    role: message.role === 'command-approval' || message.role === 'tool-execution'
      ? 'system'
      : message.role,
    content: message.content,
    tool_calls: message.toolCalls || message.tool_calls,
    tool_call_id: message.tool_call_id
  };
}

/**
 * Convert model message format to internal Message format
 */
export function fromChatMessage(chatMessage: ChatMessage, id?: string): Message {
  return {
    id: id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    role: chatMessage.role,
    content: chatMessage.content,
    toolCalls: chatMessage.tool_calls,
    tool_calls: chatMessage.tool_calls,
    tool_call_id: chatMessage.tool_call_id,
    timestamp: Date.now()
  };
}

/**
 * Convert Message array to ChatMessage array
 */
export function toChatMessages(messages: Message[]): ChatMessage[] {
  return messages.map(toChatMessage);
}

/**
 * Convert ChatMessage array to Message array
 */
export function fromChatMessages(chatMessages: ChatMessage[]): Message[] {
  return chatMessages.map(msg => fromChatMessage(msg));
}