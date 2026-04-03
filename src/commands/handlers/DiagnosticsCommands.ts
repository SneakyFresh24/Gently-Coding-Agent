import * as vscode from 'vscode';
import { CommandContext, CommandHandler } from '../types/CommandTypes';
import { DiagnosticService } from '../../services/DiagnosticService';

export class DiagnosticsCommands {
  static observabilitySnapshot(_context: CommandContext): CommandHandler {
    return {
      command: 'gently.observability.snapshot',
      handler: async () => {
        const diagnostics = DiagnosticService.getInstance();
        if (!diagnostics) {
          vscode.window.showWarningMessage('Observability is not initialized.');
          return;
        }
        const snapshot = diagnostics.getSnapshot(200);
        const doc = await vscode.workspace.openTextDocument({
          language: 'json',
          content: JSON.stringify(snapshot, null, 2)
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    };
  }

  static observabilityReset(_context: CommandContext): CommandHandler {
    return {
      command: 'gently.observability.reset',
      handler: async () => {
        const diagnostics = DiagnosticService.getInstance();
        if (!diagnostics) {
          vscode.window.showWarningMessage('Observability is not initialized.');
          return;
        }
        await diagnostics.flush();
        diagnostics.resetBuffers();
        vscode.window.showInformationMessage('Gently observability buffers were flushed and reset.');
      }
    };
  }

  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      DiagnosticsCommands.observabilitySnapshot(context),
      DiagnosticsCommands.observabilityReset(context)
    ];
  }
}
