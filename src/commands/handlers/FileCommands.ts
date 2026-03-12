// =====================================================
// File Commands - File and workspace command handlers
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandContext, FileReference, FileSearchResult, FileSearchQuickPickItem } from '../types/CommandTypes';

/**
 * File and workspace command handlers
 */
export class FileCommands {
  /**
   * Add file to context command handler
   */
  static addFileToContext(context: CommandContext): CommandHandler {
    return {
      command: 'gently.addFileToContext',
      handler: async (uri: vscode.Uri) => {
        if (!uri) {
          vscode.window.showErrorMessage('No file selected');
          return;
        }

        // Get file stats to determine if it's a file or folder
        const stat = await vscode.workspace.fs.stat(uri);
        const isFolder = stat.type === vscode.FileType.Directory;

        // Get relative path
        const relativePath = vscode.workspace.asRelativePath(uri);

        // Get file name
        const fileName = uri.path.split('/').pop() || relativePath;

        // Create file reference
        const fileReference: FileReference = {
          type: isFolder ? 'folder' : 'file',
          path: relativePath,
          displayName: fileName,
          size: isFolder ? undefined : stat.size
        };

        // Send to webview as file reference (pill)
        context.chatViewProvider.addFileReference(fileReference);

        // Show confirmation
        vscode.window.showInformationMessage(
          `Added "${fileName}" as reference to chat`
        );

        // Focus chat view
        await vscode.commands.executeCommand('gently.chatView.focus');
      }
    };
  }

  /**
   * Index workspace command handler
   */
  static indexWorkspace(context: CommandContext): CommandHandler {
    return {
      command: 'gently.indexWorkspace',
      handler: async () => {
        await context.agentManager.initialize();
      }
    };
  }

  /**
   * Read file command handler
   */
  static readFile(context: CommandContext): CommandHandler {
    return {
      command: 'gently.readFile',
      handler: async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showErrorMessage('No file is currently open');
          return;
        }

        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const fileInfo = await context.agentManager.readFile(filePath);

        vscode.window.showInformationMessage(
          `File: ${fileInfo.name} (${fileInfo.language}, ${fileInfo.size} bytes)`
        );
      }
    };
  }

  /**
   * Find files command handler
   */
  static findFiles(context: CommandContext): CommandHandler {
    return {
      command: 'gently.findFiles',
      handler: async () => {
        const query = await vscode.window.showInputBox({
          prompt: 'Enter search query',
          placeHolder: 'e.g., authentication, login function, user model'
        });

        if (!query) {
          return;
        }

        const results = await context.agentManager.findRelevantFiles(query, 10);

        if (results.length === 0) {
          vscode.window.showInformationMessage('No files found');
          return;
        }

        // Create quick pick items
        const items: FileSearchQuickPickItem[] = results.map((r: FileSearchResult) => ({
          label: r.filePath,
          description: `Score: ${r.score.toFixed(1)}`,
          detail: r.reason
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a file to open'
        });

        if (selected) {
          // Construct full path using agent manager's file operations
          const fileOps = context.agentManager.getFileOperations();
          const workspaceRoot = fileOps.getWorkspaceRoot();
          const fullPath = workspaceRoot + '/' + selected.label;
          const uri = vscode.Uri.file(fullPath);
          
          await vscode.window.showTextDocument(uri);
        }
      }
    };
  }

  /**
   * Open file command handler
   */
  static openFile(context: CommandContext): CommandHandler {
    return {
      command: 'gently.openFile',
      handler: async (filePath: string) => {
        if (!filePath) {
          vscode.window.showErrorMessage('No file path provided');
          return;
        }

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
    };
  }

  /**
   * Get all file commands
   */
  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      FileCommands.addFileToContext(context),
      FileCommands.indexWorkspace(context),
      FileCommands.readFile(context),
      FileCommands.findFiles(context),
      FileCommands.openFile(context)
    ];
  }
}