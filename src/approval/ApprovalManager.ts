import * as vscode from 'vscode';
import * as path from 'path';
import { 
  TerminalMode, 
  ApprovalRequest, 
  QuickPattern, 
  CommandEvaluation,
  AutoApprovalActions
} from '../types/approval';
import { DiagnosticService } from '../services/DiagnosticService';

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
  private static readonly ALWAYS_SAFE_TOOLS = new Set<string>([
    'recall_memories',
    'query_long_term_memory',
    'analyze_project_structure',
    'get_context',
    'list_checkpoints',
    'show_checkpoint_diff',
    'check_dev_server',
    'check_memory_conflicts',
    'check_pattern_suggestions',
    'create_plan',
    'update_plan_steps',
    'handover_to_coder',
    'ask_question',
    'create_checkpoint'
  ]);
  private static readonly READ_TOOLS = new Set<string>([
    'read_file',
    'list_files',
    'find_files',
    'regex_search',
    'search_files'
  ]);
  private static readonly EDIT_TOOLS = new Set<string>([
    'write_file',
    'edit_file',
    'safe_edit_file',
    'apply_block_edit',
    'delete_file',
    'update_memory_bank',
    'remember',
    'update_memory',
    'deprecate_memory',
    'record_correction',
    'accept_pattern_suggestion',
    'reject_pattern_suggestion',
    'restore_checkpoint'
  ]);
  private static readonly COMMAND_TOOLS = new Set<string>([
    'run_command',
    'execute_command',
    'run_terminal_command'
  ]);
  private static readonly BROWSER_TOOLS = new Set<string>([
    'web_search',
    'search_web'
  ]);
  private settings: import('../types/approval').AutoApprovalSettings;
  private readonly debugDecisions = false;

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
  }

  public async shouldAutoApprove(toolName: string, params: any): Promise<boolean> {
    if (this.settings.yoloMode) {
      this.logDecision(toolName, 'yoloMode', true);
      return true;
    }

    const normalizedToolName = toolName.toLowerCase();
    if (AutoApproveManager.ALWAYS_SAFE_TOOLS.has(normalizedToolName)) {
      this.logDecision(toolName, 'always-safe', true);
      return true;
    }

    const action = this.mapToolToAction(toolName, params);
    if (!action) {
      console.warn(`[AutoApproveManager] Unknown tool "${toolName}" - requiring explicit approval.`);
      DiagnosticService.getInstance()?.recordUnknownEvent({
        kind: 'tool',
        origin: 'auto_approve_manager',
        rawType: normalizedToolName,
        correlationId: `unknown:tool:${normalizedToolName}`,
        payload: {
          toolName: normalizedToolName
        }
      });
      this.logDecision(toolName, 'unknown', false);
      return false;
    }

    if (action === 'executeAllCommands') {
      const approved = this.settings.actions.executeAllCommands;
      this.logDecision(toolName, action, approved);
      return approved;
    }

    if (action === 'executeSafeCommands') {
      const approved = this.settings.actions.executeAllCommands || this.settings.actions.executeSafeCommands;
      this.logDecision(toolName, action, approved);
      return approved;
    }

    const approved = this.settings.actions[action];
    this.logDecision(toolName, action, approved);
    return approved;
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
      yoloMode: settings?.yoloMode ?? false,
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

    if (AutoApproveManager.READ_TOOLS.has(normalized)) {
      return this.isExternalPath(params) ? 'readFilesExternally' : 'readFiles';
    }

    if (AutoApproveManager.EDIT_TOOLS.has(normalized)) {
      return this.isExternalPath(params) ? 'editFilesExternally' : 'editFiles';
    }

    if (AutoApproveManager.COMMAND_TOOLS.has(normalized)) {
      return this.isSafeCommand(params?.command) ? 'executeSafeCommands' : 'executeAllCommands';
    }

    if (AutoApproveManager.BROWSER_TOOLS.has(normalized) || normalized.includes('browser')) {
      return 'useBrowser';
    }

    if (normalized.includes('mcp')) {
      return 'useMcp';
    }

    return null;
  }

  private isExternalPath(params: any): boolean {
    const rawPaths = this.extractPaths(params);
    if (rawPaths.length === 0) {
      return false;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    if (workspaceFolders.length === 0) {
      // Conservative policy: without workspace context, treat any path as external.
      return true;
    }

    for (const rawPath of rawPaths) {
      let withinAnyWorkspace = false;

      for (const folder of workspaceFolders) {
        const rootPath = path.normalize(folder.uri.fsPath);
        const candidatePath = path.isAbsolute(rawPath)
          ? path.normalize(rawPath)
          : path.normalize(path.join(rootPath, rawPath));

        if (this.isWithinRoot(candidatePath, rootPath)) {
          withinAnyWorkspace = true;
          break;
        }
      }

      if (!withinAnyWorkspace) {
        return true;
      }
    }
    return false;
  }

  private extractPaths(params: any): string[] {
    const paths = new Set<string>();
    const candidates = [
      params?.path,
      params?.file_path,
      params?.targetPath,
      params?.directory,
      params?.filename,
      params?.filePath
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        paths.add(candidate.trim());
      }
    }

    if (Array.isArray(params?.file_edits)) {
      for (const fileEdit of params.file_edits) {
        const nestedPath = fileEdit?.file_path || fileEdit?.path;
        if (typeof nestedPath === 'string' && nestedPath.trim().length > 0) {
          paths.add(nestedPath.trim());
        }
      }
    }

    return Array.from(paths);
  }

  private isWithinRoot(candidatePath: string, rootPath: string): boolean {
    const normalizedCandidate = path.normalize(candidatePath).toLowerCase();
    const normalizedRoot = path.normalize(rootPath).replace(/[\\\/]+$/, '').toLowerCase();
    return (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    );
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

  private logDecision(toolName: string, policy: keyof AutoApprovalActions | 'yoloMode' | 'always-safe' | 'unknown', approved: boolean): void {
    if (!this.debugDecisions) {
      return;
    }
    console.log(`[AutoApproveManager] Decision: tool=${toolName}, policy=${policy}, approved=${approved}`);
  }
}
