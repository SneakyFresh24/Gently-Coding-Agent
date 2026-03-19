import * as vscode from 'vscode';
import { 
  TerminalMode, 
  ApprovalRequest, 
  QuickPattern, 
  CommandEvaluation 
} from '../types/approval';

/**
 * Minimal stub for ApprovalManager to fix backend compilation errors.
 * This class provides safe defaults (manual mode, always requires approval).
 */
export class ApprovalManager {
  private mode: TerminalMode = 'manual';
  private quickPatterns: QuickPattern[] = [];

  constructor(
    private context: vscode.ExtensionContext,
    private sendMessageToWebview: (message: any) => void
  ) {
    console.log('[ApprovalManager Stub] Initialized');
  }

  /**
   * Evaluate command safety (Stub: always returns 'unknown')
   */
  public evaluateCommandSafety(command: string): CommandEvaluation {
    return {
      safetyLevel: 'unknown',
      reason: 'Stub implementation - safety evaluation not available'
    };
  }

  /**
   * Request approval for a command (Stub: always returns false unless handled via response)
   */
  public async requestApproval(request: ApprovalRequest): Promise<boolean> {
    console.log(`[ApprovalManager Stub] Requesting approval for: ${request.command}`);
    
    // In a real implementation, this would wait for a webview response.
    // For the stub, we'll return false to be safe, or wait for handleApprovalResponse.
    
    // We send the request to the webview
    this.sendMessageToWebview({
      type: 'approvalRequest',
      ...request
    });

    // We return a promise that will be resolved by handleApprovalResponse
    return new Promise((resolve) => {
      this.pendingApprovals.set(request.commandId, resolve);
    });
  }

  private pendingApprovals = new Map<string, (approved: boolean) => void>();

  /**
   * Handle approval response from webview
   */
  public handleApprovalResponse(commandId: string, response: any): void {
    const resolve = this.pendingApprovals.get(commandId);
    if (resolve) {
      const approved = response === 'accept' || response === 'accept_always';
      resolve(approved);
      this.pendingApprovals.delete(commandId);
    }
  }

  /**
   * Set terminal mode
   */
  public setMode(mode: TerminalMode): void {
    this.mode = mode;
  }

  /**
   * Get current terminal mode
   */
  public getMode(): TerminalMode {
    return this.mode;
  }

  /**
   * Get quick patterns
   */
  public getQuickPatterns(): QuickPattern[] {
    return this.quickPatterns;
  }

  /**
   * Toggle quick pattern
   */
  public toggleQuickPattern(name: string, enabled: boolean): void {
    const pattern = this.quickPatterns.find(p => p.name === name);
    if (pattern) {
      pattern.enabled = enabled;
    }
  }

  /**
   * Dispose and cleanup
   */
  public dispose(): void {
    this.pendingApprovals.clear();
  }
}

/**
 * Alias for HybridApprovalManager for backward compatibility during cleanup
 */
export const HybridApprovalManager = ApprovalManager;

/**
 * Minimal stub for AutoApproveManager
 */
export class AutoApproveManager {
  constructor(private context: vscode.ExtensionContext) {}
  public async shouldAutoApprove(toolName: string, params: any): Promise<boolean> {
    return false; // Safe default: never auto-approve in stub
  }
  public getSettings() {
    return {
      version: 0,
      actions: {
        readFiles: false,
        readFilesExternally: false,
        editFiles: false,
        editFilesExternally: false,
        executeSafeCommands: false,
        executeAllCommands: false,
        useBrowser: false,
        useMcp: false,
      },
      enableNotifications: true,
    };
  }
}
