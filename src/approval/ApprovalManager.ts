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
  private static readonly STORAGE_KEY = 'gently.autoApproveSettings';
  private settings: import('../types/approval').AutoApprovalSettings;

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
  }

  public async shouldAutoApprove(toolName: string, params: any): Promise<boolean> {
    const action = this.mapToolToAction(toolName, params);
    if (!action) {
      return false;
    }

    if (action === 'executeAllCommands') {
      return this.settings.actions.executeAllCommands;
    }

    if (action === 'executeSafeCommands') {
      return this.settings.actions.executeAllCommands || this.settings.actions.executeSafeCommands;
    }

    return this.settings.actions[action];
  }

  public addAutoApproval(toolName: string): void {
    const action = this.mapToolToAction(toolName, undefined);
    if (!action) {
      console.log(`[AutoApproveManager] No auto-approval mapping found for tool: ${toolName}`);
      return;
    }

    this.settings = {
      ...this.settings,
      version: this.settings.version + 1,
      actions: {
        ...this.settings.actions,
        [action]: true,
      },
    };

    void this.persistSettings();
  }

  public getSettings() {
    return this.settings;
  }

  public async setSettings(settings: import('../types/approval').AutoApprovalSettings): Promise<void> {
    this.settings = this.normalizeSettings(settings);
    await this.persistSettings();
  }

  private loadSettings(): import('../types/approval').AutoApprovalSettings {
    const stored = this.context.globalState.get<import('../types/approval').AutoApprovalSettings>(
      AutoApproveManager.STORAGE_KEY
    );
    return this.normalizeSettings(stored);
  }

  private normalizeSettings(
    settings?: Partial<import('../types/approval').AutoApprovalSettings>
  ): import('../types/approval').AutoApprovalSettings {
    return {
      version: settings?.version ?? 0,
      actions: {
        readFiles: settings?.actions?.readFiles ?? false,
        readFilesExternally: settings?.actions?.readFilesExternally ?? false,
        editFiles: settings?.actions?.editFiles ?? false,
        editFilesExternally: settings?.actions?.editFilesExternally ?? false,
        executeSafeCommands: settings?.actions?.executeSafeCommands ?? false,
        executeAllCommands: settings?.actions?.executeAllCommands ?? false,
        useBrowser: settings?.actions?.useBrowser ?? false,
        useMcp: settings?.actions?.useMcp ?? false,
      },
      enableNotifications: settings?.enableNotifications ?? true,
    };
  }

  private async persistSettings(): Promise<void> {
    await this.context.globalState.update(AutoApproveManager.STORAGE_KEY, this.settings);
  }

  private mapToolToAction(
    toolName: string,
    params: any
  ): keyof import('../types/approval').AutoApprovalActions | null {
    const normalized = toolName.toLowerCase();

    if (['read_file', 'list_files', 'find_files', 'search_files'].includes(normalized)) {
      return this.isExternalPath(params) ? 'readFilesExternally' : 'readFiles';
    }

    if (
      ['write_file', 'edit_file', 'safe_edit_file', 'apply_block_edit', 'delete_file'].includes(normalized)
    ) {
      return this.isExternalPath(params) ? 'editFilesExternally' : 'editFiles';
    }

    if (['run_command', 'execute_command', 'run_terminal_command'].includes(normalized)) {
      return this.isSafeCommand(params?.command) ? 'executeSafeCommands' : 'executeAllCommands';
    }

    if (normalized.includes('browser') || normalized.includes('web')) {
      return 'useBrowser';
    }

    if (normalized.includes('mcp')) {
      return 'useMcp';
    }

    return null;
  }

  private isExternalPath(params: any): boolean {
    const rawPath = params?.path || params?.file_path || params?.targetPath || params?.directory;
    if (!rawPath || !vscode.workspace.workspaceFolders?.length) {
      return false;
    }

    const candidate = vscode.Uri.file(rawPath);
    return !vscode.workspace.workspaceFolders.some((folder) => {
      const folderPath = folder.uri.fsPath.replace(/[\\\/]+$/, '').toLowerCase();
      const candidatePath = candidate.fsPath.toLowerCase();
      return candidatePath === folderPath || candidatePath.startsWith(`${folderPath}\\`) || candidatePath.startsWith(`${folderPath}/`);
    });
  }

  private isSafeCommand(command?: string): boolean {
    if (!command) {
      return false;
    }

    const trimmed = command.trim().toLowerCase();
    return [
      'pwd',
      'ls',
      'dir',
      'echo',
      'cat',
      'type',
      'git status',
      'git diff',
      'git log',
      'npm test',
      'npm run test'
    ].some((safePrefix) => trimmed === safePrefix || trimmed.startsWith(`${safePrefix} `));
  }
}
