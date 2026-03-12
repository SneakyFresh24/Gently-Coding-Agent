// =====================================================
// Webview Communicator - Webview communication logic
// =====================================================

import {
  WebviewCommunicator,
  WebviewMessage,
  WebviewMessageType,
  ToolExecutionStartMessage,
  TerminalOutputChunkMessage,
  ApprovalRequestMessage,
  TerminalModeChangedMessage,
  QuickPatternsChangedMessage,
  TerminalStatusMessage,
  FallbackModeUsedMessage
} from './types/CommunicationTypes';
import { ApprovalRequest, TerminalMode, QuickPattern } from '../HybridApprovalManager';
import { OutputChunk } from '../execution/types/ExecutionTypes';

/**
 * Webview communicator implementation
 */
export class WebviewCommunicatorImpl implements WebviewCommunicator {
  private sendMessageToWebview: (message: any) => void;
  private disposed: boolean = false;

  constructor(sendMessageToWebview: (message: any) => void) {
    this.sendMessageToWebview = sendMessageToWebview;
  }

  /**
   * Send tool execution start message
   */
  sendExecutionStart(toolName: string): void {
    if (this.disposed) {
      return;
    }

    const message: ToolExecutionStartMessage = {
      type: WebviewMessageType.TOOL_EXECUTION_START,
      toolName,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send output chunk message
   */
  sendOutputChunk(commandId: string, chunk: OutputChunk): void {
    if (this.disposed) {
      return;
    }

    const message: TerminalOutputChunkMessage = {
      type: WebviewMessageType.TERMINAL_OUTPUT_CHUNK,
      commandId,
      chunk,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send error message
   */
  sendError(commandId: string, error: Error): void {
    if (this.disposed) {
      return;
    }

    const errorChunk: OutputChunk = {
      type: 'error',
      message: error.message,
      timestamp: Date.now()
    };

    this.sendOutputChunk(commandId, errorChunk);
  }

  /**
   * Send approval request message
   */
  sendApprovalRequest(request: ApprovalRequest): void {
    if (this.disposed) {
      return;
    }

    const message: ApprovalRequestMessage = {
      type: WebviewMessageType.APPROVAL_REQUEST,
      request,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send terminal mode changed message
   */
  sendModeChanged(mode: TerminalMode): void {
    if (this.disposed) {
      return;
    }

    const message: TerminalModeChangedMessage = {
      type: WebviewMessageType.TERMINAL_MODE_CHANGED,
      mode,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send quick patterns changed message
   */
  sendPatternsChanged(patterns: QuickPattern[]): void {
    if (this.disposed) {
      return;
    }

    const message: QuickPatternsChangedMessage = {
      type: WebviewMessageType.QUICK_PATTERNS_CHANGED,
      patterns,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send terminal status message
   */
  sendStatus(activeCommands: string[], mode: TerminalMode): void {
    if (this.disposed) {
      return;
    }

    const message: TerminalStatusMessage = {
      type: WebviewMessageType.TERMINAL_STATUS,
      activeCommands,
      mode,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send fallback mode used message
   */
  sendFallbackModeUsed(commandId: string, shellType: string): void {
    if (this.disposed) {
      return;
    }

    const message: FallbackModeUsedMessage = {
      type: WebviewMessageType.FALLBACK_MODE_USED,
      commandId,
      shellType,
      timestamp: Date.now()
    };

    this.sendMessage(message);
  }

  /**
   * Send message to webview
   */
  private sendMessage(message: WebviewMessage): void {
    try {
      console.log(`[WebviewCommunicator] Sending message: ${message.type}`);
      this.sendMessageToWebview(message);
    } catch (error) {
      console.error('[WebviewCommunicator] Error sending message:', error);
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    console.log('[WebviewCommunicator] Disposing...');
    this.disposed = true;
  }
}