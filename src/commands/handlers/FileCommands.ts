// =====================================================
// File Commands - File and workspace command handlers
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandContext } from '../types/CommandTypes';

/**
 * File and workspace command handlers
 */
export class FileCommands {
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
      FileCommands.openFile(context)
    ];
  }
}
