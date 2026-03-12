// =====================================================
// File Handler
// =====================================================

import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { FileReferenceManager, FileReference } from '../../../agent/fileReferenceManager';

export class FileHandler {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly fileReferenceManager: FileReferenceManager,
    private readonly sendMessageToWebview: (message: any) => void
  ) {}

  async addFileReference(fileRef: FileReference): Promise<void> {
    if (fileRef.type === 'file') {
      try {
        const fileInfo = await this.agentManager.getFileOperations().readFile(fileRef.path);
        fileRef.content = fileInfo.content;
      } catch (error) {
        console.error('[FileHandler] Error loading file content for preview:', error);
      }
    }

    this.sendMessageToWebview({
      type: 'addFileReference',
      fileReference: fileRef
    });
  }

  async handleOpenFile(filePath: string): Promise<void> {
    try {
      // Resolve relative path to workspace
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const fullPath = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);

      // Open the file
      const document = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      console.error('Error opening file:', error);
      vscode.window.showErrorMessage(`Could not open file: ${filePath}`);
    }
  }

  async handleSearchFiles(query: string): Promise<void> {
    console.log('[FileHandler] Searching files for query:', query);

    try {
      const results = await this.fileReferenceManager.searchFiles(query, 10);

      console.log('[FileHandler] Found', results.length, 'results');

      this.sendMessageToWebview({
        type: 'fileSearchResults',
        results
      });
    } catch (error) {
      console.error('[FileHandler] Error searching files:', error);
      this.sendMessageToWebview({
        type: 'fileSearchResults',
        results: []
      });
    }
  }

  async handleOpenFilePicker(): Promise<void> {
    // Show quick pick to choose between files or folders
    const choice = await vscode.window.showQuickPick([
      { label: '$(file) Add Files', value: 'files', description: 'Select one or more files' },
      { label: '$(folder) Add Folders', value: 'folders', description: 'Select one or more folders' },
      { label: '$(files) Add Files & Folders', value: 'both', description: 'Select files and folders' }
    ], {
      placeHolder: 'What do you want to add to context?'
    });

    if (!choice) {
      return; // User cancelled
    }

    // Get workspace root as default URI
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const defaultUri = workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri
      : undefined;

    const options: vscode.OpenDialogOptions = {
      canSelectMany: true,
      canSelectFiles: choice.value === 'files' || choice.value === 'both',
      canSelectFolders: choice.value === 'folders' || choice.value === 'both',
      openLabel: 'Add to Context',
      title: choice.label,
      defaultUri: defaultUri
    };

    const uris = await vscode.window.showOpenDialog(options);

    if (uris && uris.length > 0) {
      for (const uri of uris) {
        // Get file stats
        const stat = await vscode.workspace.fs.stat(uri);
        const isFolder = stat.type === vscode.FileType.Directory;

        // Get relative path
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Get file name
        const fileName = uri.path.split('/').pop() || relativePath;

        // Send to webview
        await this.addFileReference({
          type: isFolder ? 'folder' : 'file',
          path: relativePath,
          displayName: fileName,
          size: isFolder ? undefined : stat.size
        });
      }

      // Show confirmation
      vscode.window.showInformationMessage(
        `Added ${uris.length} ${uris.length === 1 ? 'item' : 'items'} to context`
      );
    }
  }

  async handleRequestFilePreview(filePath: string): Promise<void> {
    try {
      // Load file content
      const fileInfo = await this.agentManager.getFileOperations().readFile(filePath);

      // Send back to webview
      this.sendMessageToWebview({
        type: 'filePreviewContent',
        path: filePath,
        content: fileInfo.content
      });
    } catch (error) {
      console.error('[FileHandler] Error loading file preview:', error);
      // Send empty content on error
      this.sendMessageToWebview({
        type: 'filePreviewContent',
        path: filePath,
        content: ''
      });
    }
  }

  async handleTogglePinFile(filePath: string): Promise<void> {
    const file = this.agentManager.getContextManager().getFile(filePath);

    if (file) {
      if (file.pinned) {
        this.agentManager.unpinFile(filePath);
      } else {
        this.agentManager.pinFile(filePath);
      }

      // Send updated context
      await this.sendContextUpdate();
    }
  }

  private async sendContextUpdate(): Promise<void> {
    const files = this.agentManager.getTrackedFiles();
    const stats = this.agentManager.getContextStats();

    this.sendMessageToWebview({
      type: 'contextUpdate',
      files,
      stats,
    });
  }

  /**
   * Get file information
   */
  async getFileInfo(filePath: string): Promise<any> {
    try {
      return await this.agentManager.getFileOperations().readFile(filePath);
    } catch (error) {
      console.error('[FileHandler] Error getting file info:', error);
      return null;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      return await this.agentManager.getFileOperations().fileExists(filePath);
    } catch (error) {
      console.error('[FileHandler] Error checking file existence:', error);
      return false;
    }
  }

  /**
   * Get file language from path
   */
  getFileLanguage(filePath: string): string {
    // Simple language detection based on file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    const languageMap: { [key: string]: string } = {
      'ts': 'typescript',
      'js': 'javascript',
      'jsx': 'javascript',
      'tsx': 'typescript',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'sql': 'sql',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'ps1': 'powershell',
      'dockerfile': 'dockerfile',
      'vue': 'vue',
      'svelte': 'svelte'
    };
    return languageMap[ext || ''] || 'text';
  }

  /**
   * Format file size
   */
  formatFileSize(bytes: number): string {
    return this.fileReferenceManager.formatFileSize(bytes);
  }

  /**
   * Get display name for file
   */
  getDisplayName(filePath: string): string {
    // Extract file name from path
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Parse file references from input
   */
  parseReferences(input: string): { cleanedMessage: string; references: any[] } {
    return this.fileReferenceManager.parseReferences(input);
  }

  /**
   * Load file references
   */
  async loadReferences(references: any[]): Promise<FileReference[]> {
    return await this.fileReferenceManager.loadReferences(references);
  }

  /**
   * Generate context prompt from references
   */
  generateContextPrompt(references: FileReference[]): string {
    return this.fileReferenceManager.generateContextPrompt(references);
  }
}