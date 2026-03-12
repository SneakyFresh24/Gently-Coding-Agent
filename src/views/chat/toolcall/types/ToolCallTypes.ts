// =====================================================
// Tool Call Types - Neue Tool-Call-Architektur
// =====================================================

import { ChatMessage } from '../../../../services/OpenRouterService';

/**
 * Repräsentiert einen Tool-Call mit allen Metadaten
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: ToolCallResult;
  error?: string;
  startTime?: number;
  endTime?: number;
  executionTime?: number;
}

/**
 * Result of a tool call execution
 */
export type ToolCallResult =
  | { type: 'success'; data: Record<string, unknown> }
  | { type: 'file_operation'; path: string; operation: string; content?: string }
  | { type: 'terminal_output'; output: string; exitCode?: number }
  | { type: 'validation_result'; valid: boolean; errors?: string[]; warnings?: string[] }
  | { type: 'memory_operation'; memoryId: string; content: string }
  | { type: 'planning_result'; planId: string; steps: string[] }
  | { type: 'raw'; value: unknown };

/**
 * Repräsentiert eine Tool-Call-Gruppe, die zusammen gehört
 */
export interface ToolCallGroup {
  id: string;
  messageId: string;
  toolCalls: ToolCall[];
  status: 'pending' | 'executing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
  totalExecutionTime?: number;
}

/**
 * Validierungsergebnis für Tool-Call-Nachrichten
 */
export interface ToolCallValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  toolCallGroups: ToolCallGroup[];
}

/**
 * Konfiguration für den ToolCallManager
 */
export interface ToolCallManagerConfig {
  enableValidation: boolean;
  enableMigration: boolean;
  maxConcurrentToolCalls: number;
  toolExecutionTimeout: number;
  enableDetailedLogging: boolean;
}

/**
 * Event-Typen für Tool-Call-Ereignisse
 */
export type ToolCallEventType =
  | 'tool_calls_received'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'tool_call_failed'
  | 'tool_group_completed'
  | 'validation_error'
  | 'migration_error';

/**
 * Tool-Call-Event
 */
export interface ToolCallEvent {
  type: ToolCallEventType;
  toolCallId?: string;
  groupId?: string;
  messageId?: string;
  data?: ToolCallEventData;
  timestamp: number;
}

/**
 * Tool-Call Event Data (discriminated union)
 */
export type ToolCallEventData =
  | { eventType: 'tool_calls_received'; toolCalls: ToolCall[] }
  | { eventType: 'tool_call_started'; toolCallId: string; toolName: string }
  | { eventType: 'tool_call_completed'; toolCallId: string; result: ToolCallResult }
  | { eventType: 'tool_call_failed'; toolCallId: string; error: string }
  | { eventType: 'tool_group_completed'; groupId: string; totalTime: number; success: boolean; toolCallIds?: string[] }
  | { eventType: 'validation_error'; errors: string[] }
  | { eventType: 'migration_error'; error: string };

/**
 * Result of tool call execution
 */
export interface ToolCallExecutionResult {
  success: boolean;
  toolCallId: string;
  groupId: string;
  result?: ToolCallResult;
  error?: string;
  executionTime: number;
}

/**
 * Nachrichten-Kontext für Tool-Call-Validierung
 */
export interface ToolCallMessageContext {
  conversationHistory: ChatMessage[];
  messageId?: string;
  flowId?: string;
  isStreaming?: boolean;
  selectedMode?: string; // NEW: Current mode for validation
}

/**
 * Interface für Tool-Call-Listener
 */
export interface ToolCallListener {
  onToolCallEvent(event: ToolCallEvent): void;
}

/**
 * Interface für Tool-Call-Validator
 */
export interface ToolCallValidator {
  validateToolCalls(toolCalls: ToolCall[], context: ToolCallMessageContext): ToolCallValidationResult;
  validateMessageSequence(messages: ChatMessage[], options?: { skipMissingToolMessagesCheck?: boolean }): { valid: boolean; errors: string[] };
}

/**
 * Interface für Tool-Call-Tracker
 */
export interface ToolCallTracker {
  trackToolCall(toolCall: ToolCall, groupId: string): void;
  updateToolCallStatus(toolCallId: string, status: ToolCall['status'], result?: ToolCallResult, error?: string): void;
  getToolCall(toolCallId: string): ToolCall | undefined;
  getToolGroup(groupId: string): ToolCallGroup | undefined;
  getActiveGroups(): ToolCallGroup[];
  cleanupCompletedGroups(maxAge: number): void;
}