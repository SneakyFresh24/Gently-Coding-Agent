// =====================================================
// Guardian Commands - Command handlers for Guardian features
// =====================================================

import * as vscode from 'vscode';
import { CommandContext, CommandHandler } from '../types/CommandTypes';

export class GuardianCommands {
  private context: CommandContext;

  constructor(context: CommandContext) {
    this.context = context;
  }

  /**
   * Get all Guardian commands
   */
  static getAllCommands(context: CommandContext): CommandHandler[] {
    const commands = new GuardianCommands(context);
    return [
      {
        command: 'gently.guardian.analyzeWorkspace',
        handler: commands.analyzeWorkspace.bind(commands)
      },
      {
        command: 'gently.guardian.analyzeFile',
        handler: commands.analyzeFile.bind(commands)
      },
      {
        command: 'gently.guardian.showIssues',
        handler: commands.showIssues.bind(commands)
      },
      {
        command: 'gently.guardian.dismissAllIssues',
        handler: commands.dismissAllIssues.bind(commands)
      },
      {
        command: 'gently.guardian.fixAllIssues',
        handler: commands.fixAllIssues.bind(commands)
      }
    ];
  }

  /**
   * Get Guardian integration from context
   */
  private getGuardianIntegration() {
    // Only try to get from global scope to avoid extensible object error
    return (global as any).guardianIntegration ||
           (this.context.extensionContext as any).guardianIntegration;
  }

  /**
   * Start Guardian
   */
  private async startGuardian(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      await guardianIntegration.start();
      vscode.window.showInformationMessage('🛡️ Guardian started successfully');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to start Guardian: ${error}`);
    }
  }

  /**
   * Stop Guardian
   */
  private async stopGuardian(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      await guardianIntegration.stop();
      vscode.window.showInformationMessage('Guardian stopped');
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to stop Guardian: ${error}`);
    }
  }

  /**
   * Analyze workspace
   */
  private async analyzeWorkspace(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      await guardianIntegration.analyzeWorkspace();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to analyze workspace: ${error}`);
    }
  }

  /**
   * Analyze current file
   */
  private async analyzeFile(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      await guardianIntegration.analyzeActiveFile();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to analyze file: ${error}`);
    }
  }

  /**
   * Show issues
   */
  private async showIssues(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      await guardianIntegration.showIssues();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to show issues: ${error}`);
    }
  }

  /**
   * Dismiss all issues
   */
  private async dismissAllIssues(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      guardianIntegration.dismissAllIssues();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to dismiss issues: ${error}`);
    }
  }

  /**
   * Open Guardian settings
   */
  private async openSettings(): Promise<void> {
    try {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'gently.guardian'
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open settings: ${error}`);
    }
  }

  /**
   * Fix all issues
   */
  private async fixAllIssues(): Promise<void> {
    try {
      const guardianIntegration = this.getGuardianIntegration();
      
      if (!guardianIntegration) {
        vscode.window.showErrorMessage('Guardian integration not available');
        return;
      }

      // Access the private method through reflection
      const fixAllIssuesMethod = (guardianIntegration as any).fixAllIssues;
      if (typeof fixAllIssuesMethod === 'function') {
        await fixAllIssuesMethod.call(guardianIntegration);
      } else {
        vscode.window.showErrorMessage('Fix all issues method not available');
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fix issues: ${error}`);
    }
  }
}