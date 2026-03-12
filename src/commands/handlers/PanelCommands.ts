// =====================================================
// Panel Commands - Panel-related command handlers
// =====================================================

import { MemoriesPanel } from '../../views/memoriesPanel';
import { CommandHandler, CommandContext } from '../types/CommandTypes';

/**
 * Panel-related command handlers
 */
export class PanelCommands {
  /**
   * Open memories panel command handler
   */
  static openMemories(context: CommandContext): CommandHandler {
    return {
      command: 'gently.openMemories',
      handler: () => {
        MemoriesPanel.createOrShow(context.extensionContext.extensionUri, context.agentManager);
      }
    };
  }

  /**
   * Get all panel commands
   */
  static getAllCommands(context: CommandContext): CommandHandler[] {
    return [
      PanelCommands.openMemories(context)
    ];
  }
}