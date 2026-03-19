// =====================================================
// Communication Types - Type definitions for webview communication
// =====================================================

import { ApprovalRequest, TerminalMode, QuickPattern } from '../../../types/approval';
import { OutputChunk } from '../../execution/types/ExecutionTypes';

/**
 * Webview message types
 */
export enum WebviewMessageType {
  TOOL_EXECUTION_START = 'toolExecutionStart',
  TERMINAL_OUTPUT_CHUNK = 'terminalOutputChunk',
  APPROVAL_REQUEST = 'approvalRequest',
  APPROVAL_RESPONSE = 'approvalResponse',
  TERMINAL_MODE_CHANGED = 'terminalModeChanged',
  QUICK_PATTERNS_CHANGED = 'quickPatternsChanged',
  TERMINAL_STATUS = 'terminalStatus',
  FALLBACK_MODE_USED = 'fallbackModeUsed'
}

/**
 * Base webview message
 */
export interface BaseWebviewMessage {
  type: WebviewMessageType;
  timestamp: number;
}

/**
 * Tool execution start message
 */
export interface ToolExecutionStartMessage extends BaseWebviewMessage {
  type: WebviewMessageType.TOOL_EXECUTION_START;
  toolName: string;
}

/**
 * Terminal output chunk message
 */
export interface TerminalOutputChunkMessage extends BaseWebviewMessage {
  type: WebviewMessageType.TERMINAL_OUTPUT_CHUNK;
  commandId: string;
  chunk: OutputChunk;
}

/**
 * Approval request message
 */
export interface ApprovalRequestMessage extends BaseWebviewMessage {
  type: WebviewMessageType.APPROVAL_REQUEST;
  request: ApprovalRequest;
}

/**
 * Approval response message
 */
export interface ApprovalResponseMessage extends BaseWebviewMessage {
  type: WebviewMessageType.APPROVAL_RESPONSE;
  commandId: string;
  approved: boolean;
}

/**
 * Terminal mode changed message
 */
export interface TerminalModeChangedMessage extends BaseWebviewMessage {
  type: WebviewMessageType.TERMINAL_MODE_CHANGED;
  mode: TerminalMode;
}

/**
 * Quick patterns changed message
 */
export interface QuickPatternsChangedMessage extends BaseWebviewMessage {
  type: WebviewMessageType.QUICK_PATTERNS_CHANGED;
  patterns: QuickPattern[];
}

/**
 * Terminal status message
 */
export interface TerminalStatusMessage extends BaseWebviewMessage {
  type: WebviewMessageType.TERMINAL_STATUS;
  activeCommands: string[];
  mode: TerminalMode;
}

/**
 * Fallback mode used message
 */
export interface FallbackModeUsedMessage extends BaseWebviewMessage {
  type: WebviewMessageType.FALLBACK_MODE_USED;
  commandId: string;
  shellType: string;
}

/**
 * Webview message union
 */
export type WebviewMessage =
  | ToolExecutionStartMessage
  | TerminalOutputChunkMessage
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | TerminalModeChangedMessage
  | QuickPatternsChangedMessage
  | TerminalStatusMessage
  | FallbackModeUsedMessage;

/**
 * Webview communicator interface
 */
export interface WebviewCommunicator {
  sendExecutionStart(toolName: string): void;
  sendOutputChunk(commandId: string, chunk: OutputChunk): void;
  sendError(commandId: string, error: Error): void;
  sendApprovalRequest(request: ApprovalRequest): void;
  sendModeChanged(mode: TerminalMode): void;
  sendPatternsChanged(patterns: QuickPattern[]): void;
  sendStatus(activeCommands: string[], mode: TerminalMode): void;
  sendFallbackModeUsed(commandId: string, shellType: string): void;
  dispose(): void;
}