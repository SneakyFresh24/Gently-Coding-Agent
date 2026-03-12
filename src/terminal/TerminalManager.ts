// =====================================================
// Terminal Manager Refactored - Coordinated terminal execution
// =====================================================

import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { ShellIntegrationExecutor } from './ShellIntegrationExecutor';
import { HybridApprovalManager, TerminalMode, QuickPattern } from './HybridApprovalManager';
import { WebviewCommunicatorImpl } from './communication/WebviewCommunicator';
import { ExecutionOptions, CommandResult, OutputChunk } from './execution/types/ExecutionTypes';
import { ApprovalRequest } from './HybridApprovalManager';
import { GuardianService } from '../guardian/GuardianService';

/**
 * Terminal Manager implementation with modular architecture
 */
export class TerminalManager {
  private executor: ShellIntegrationExecutor;
  private approvalManager: HybridApprovalManager;
  private webviewCommunicator: WebviewCommunicatorImpl;
  private guardian: GuardianService | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private sendMessageToWebview: (message: any) => void,
    guardianService?: GuardianService
  ) {
    // Initialize components
    this.webviewCommunicator = new WebviewCommunicatorImpl(sendMessageToWebview);
    this.executor = new ShellIntegrationExecutor(this.webviewCommunicator);
    this.approvalManager = new HybridApprovalManager(context, sendMessageToWebview);
    this.guardian = guardianService || null;

    console.log('[TerminalManager] Initialized with modular architecture (Refactored)');
  }

  /**
   * Set the Guardian service for security checks
   */
  public setGuardianService(guardian: GuardianService): void {
    this.guardian = guardian;
    console.log('[TerminalManager] Guardian service bridged');
  }

  /**
   * Execute a command with approval handling
   */
  async executeCommand(
    command: string,
    reason: string,
    options: ExecutionOptions = {}
  ): Promise<CommandResult> {
    const commandId = uuidv4();

    console.log(`[TerminalManager] Execute command request: ${command}`);
    console.log(`[TerminalManager] Reason: ${reason}`);
    console.log(`[TerminalManager] Command ID: ${commandId}`);

    try {
      // Determine working directory
      const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      // 1. Guardian Check (Security)
      if (this.guardian) {
        const securityCheck = await this.guardian.beforeRunCommand(command);
        if (!securityCheck.allow) {
          console.warn(`[TerminalManager] Command blocked by Guardian: ${securityCheck.reason}`);
          throw new Error(`Security Exception: ${securityCheck.reason}`);
        }
      }

      // Check autoConfirm flag
      if (options.autoConfirm) {
        console.log(`[TerminalManager] Auto-confirm enabled, skipping approval request`);
      } else {
        // Evaluate command safety via HybridApprovalManager
        const evaluation = this.approvalManager.evaluateCommandSafety(command);

        console.log(`[TerminalManager] Safety evaluation:`, evaluation);

        // Create approval request
        const approvalRequest: ApprovalRequest = {
          commandId,
          command,
          cwd,
          reason,
          safetyLevel: evaluation.safetyLevel,
          timestamp: Date.now()
        };

        // Request approval
        const approved = await this.approvalManager.requestApproval(approvalRequest);

        if (!approved) {
          console.log(`[TerminalManager] Command rejected by user`);
          throw new Error('Command execution rejected by user');
        }

        console.log(`[TerminalManager] Command approved, executing...`);
      }

      // Send toolExecutionStart AFTER approval
      this.webviewCommunicator.sendExecutionStart('execute_command');

      // Execute command with streaming
      const result = await this.executor.executeStreaming(
        commandId,
        command,
        {
          ...options,
          cwd
        },
        (chunk: OutputChunk) => {
          // Forward output chunks to webview
          this.webviewCommunicator.sendOutputChunk(commandId, chunk);
        }
      );

      console.log(`[TerminalManager] Command completed:`, {
        exitCode: result.exitCode,
        duration: result.duration,
        success: result.success
      });

      return result;
    } catch (error) {
      console.error(`[TerminalManager] Command execution failed:`, error);

      // Send error to webview
      this.webviewCommunicator.sendError(commandId, error instanceof Error ? error : new Error('Unknown error'));

      throw error;
    }
  }

  /**
   * Kill a running command
   */
  killCommand(commandId: string): boolean {
    console.log(`[TerminalManager] Kill command request: ${commandId}`);
    return this.executor.killCommand(commandId);
  }

  /**
   * Check if a command is running
   */
  isCommandRunning(commandId: string): boolean {
    return this.executor.isCommandRunning(commandId);
  }

  /**
   * Get all running command IDs
   */
  getRunningCommandIds(): string[] {
    return this.executor.getActiveCommands();
  }

  /**
   * Set terminal mode
   */
  setTerminalMode(mode: any): void {
    this.approvalManager.setMode(mode);

    // Notify webview
    this.webviewCommunicator.sendModeChanged(mode);
  }

  /**
   * Get current terminal mode
   */
  getTerminalMode(): TerminalMode {
    return this.approvalManager.getMode();
  }

  /**
   * Get quick patterns
   */
  getQuickPatterns(): QuickPattern[] {
    return this.approvalManager.getQuickPatterns();
  }

  /**
   * Toggle quick pattern
   */
  toggleQuickPattern(name: string, enabled: boolean): void {
    this.approvalManager.toggleQuickPattern(name, enabled);

    // Notify webview
    this.webviewCommunicator.sendPatternsChanged(this.approvalManager.getQuickPatterns());
  }

  /**
   * Handle approval response from webview
   */
  handleApprovalResponse(commandId: string, response: any): void {
    this.approvalManager.handleApprovalResponse(commandId, response);
  }

  /**
   * Send terminal status to webview
   */
  sendTerminalStatus(): void {
    const activeCommands = this.getRunningCommandIds();
    const mode = this.getTerminalMode();

    this.webviewCommunicator.sendStatus(activeCommands, mode);
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    console.log('[TerminalManager] Disposing...');

    // Dispose all components
    this.executor.dispose();
    this.approvalManager.dispose();
    this.webviewCommunicator.dispose();
  }
}