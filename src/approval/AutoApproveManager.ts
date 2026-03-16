import * as vscode from 'vscode';
import * as path from 'path';
import { AutoApproveSettings, DEFAULT_AUTO_APPROVAL_SETTINGS } from './AutoApproveSettings';

/**
 * AutoApproveManager
 * Manages tool approval logic, persistence, and safety evaluation.
 */
export class AutoApproveManager {
  private static readonly SETTINGS_KEY = 'gently.autoApprove.settings';
  private settings: AutoApproveSettings;

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
  }

  /**
   * Load settings from globalState
   */
  private loadSettings(): AutoApproveSettings {
    const saved = this.context.globalState.get<AutoApproveSettings>(AutoApproveManager.SETTINGS_KEY);
    return saved ? { ...DEFAULT_AUTO_APPROVAL_SETTINGS, ...saved } : DEFAULT_AUTO_APPROVAL_SETTINGS;
  }

  /**
   * Save settings to globalState
   */
  public async setSettings(settings: AutoApproveSettings): Promise<void> {
    this.settings = settings;
    await this.context.globalState.update(AutoApproveManager.SETTINGS_KEY, settings);
  }

  /**
   * Get current settings
   */
  public getSettings(): AutoApproveSettings {
    return { ...this.settings };
  }

  /**
   * Main entry point for approval decisions
   */
  public async shouldAutoApprove(toolName: string, params: any): Promise<boolean> {
    // 1. YOLO Mode bypass
    if (this.settings.yoloMode) {
      return true;
    }

    // 2. Logic based on tool category
    switch (toolName) {
      case 'read_file':
      case 'list_files':
      case 'find_files':
      case 'search_files':
        return this.checkFilePathApproval('read', params.path || params.file_path);

      case 'write_file':
      case 'edit_file':
      case 'safe_edit_file':
      case 'apply_block_edit':
      case 'delete_file':
      case 'create_directory':
        return this.checkFilePathApproval('edit', params.path || params.file_path);

      case 'execute_command':
      case 'run_command':
        return this.checkCommandApproval(params.command);

      case 'browser_action':
      case 'use_browser':
        return this.settings.useBrowser;

      case 'use_mcp_tool':
      case 'execute_mcp_tool':
        return this.settings.useMcp;

      // Internal/Planning tools are usually auto-approved as they don't affect the external system
      case 'create_plan':
      case 'update_plan':
      case 'recall_memories':
      case 'update_memory_bank':
        return true;

      default:
        // By default, if we don't know the tool, we ask for approval
        return false;
    }
  }

  /**
   * Check if a file path is within the workspace and if it's approved
   */
  private checkFilePathApproval(type: 'read' | 'edit', filePath?: string): boolean {
    if (!filePath) return true; // Operations without path (like list_files in root) often safe or handled separately

    const isInside = this.isInsideWorkspace(filePath);
    
    if (type === 'read') {
      return isInside ? this.settings.readFiles : this.settings.readFilesExternally;
    } else {
      return isInside ? this.settings.editFiles : this.settings.editFilesExternally;
    }
  }

  /**
   * Check command safety and approval
   */
  private checkCommandApproval(command: string): boolean {
    if (this.settings.executeAllCommands) return true;
    if (!this.settings.executeSafeCommands) return false;

    // Use a subset of known safe command patterns
    const safeRegex = /^(npm|pnpm|yarn|git|ls|dir|pwd|echo|cat|type)\b/i;
    return safeRegex.test(command.trim());
  }

  /**
   * Helper: Is path inside the current workspace?
   */
  private isInsideWorkspace(filePath: string): boolean {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return false;

    // Resolve absolute path
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(workspaceFolders[0].uri.fsPath, filePath);

    return workspaceFolders.some(folder => {
      const relative = path.relative(folder.uri.fsPath, absolutePath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }
}
