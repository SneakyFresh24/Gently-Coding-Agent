// =====================================================
// Chat Commands - Chat-related command handlers
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandContext } from '../types/CommandTypes';

/**
 * Chat-related command handlers
 */
export class ChatCommands {
  /**
   * Open chat command handler
   */
  static openChat(context: CommandContext): CommandHandler {
    return {
      command: 'gently.openChat',
      handler: async () => {
        await vscode.commands.executeCommand('gently.chatView.focus');
      }
    };
  }

  /**
   * Clear history command handler
   */
  static clearHistory(context: CommandContext): CommandHandler {
    return {
      command: 'gently.clearHistory',
      handler: async () => {
        context.chatViewProvider.clearHistory();
      }
    };
  }

  /**
   * Toggle between architect and code mode.
   */
  static toggleAgentMode(context: CommandContext): CommandHandler {
    return {
      command: 'gently.toggleAgentMode',
      handler: async () => {
        const currentMode = context.modeService.getCurrentMode()?.id ?? 'architect';
        const nextMode = currentMode === 'code' ? 'architect' : 'code';
        await context.chatViewProvider.setSelectedMode(nextMode);
      }
    };
  }

  /**
   * Get all chat commands
   */
  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      ChatCommands.openChat(context),
      ChatCommands.clearHistory(context),
      ChatCommands.toggleAgentMode(context)
    ];
  }
}
