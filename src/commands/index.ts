// =====================================================
// Commands Index - Central export for all command handlers
// =====================================================

import { CommandRegistry } from './CommandRegistry';
import { CommandContext, CommandRegistrationOptions } from './types/CommandTypes';
import { ChatCommands } from './handlers/ChatCommands';
import { SettingsCommands } from './handlers/SettingsCommands';
import { FileCommands } from './handlers/FileCommands';
import { PanelCommands } from './handlers/PanelCommands';

/**
 * Initialize and register all commands
 */
export function initializeCommands(context: CommandContext): CommandRegistry {
  const registrationOptions: CommandRegistrationOptions = {
    context,
    subscriptions: context.extensionContext.subscriptions
  };

  const registry = new CommandRegistry(registrationOptions);

  // Register all command groups
  registry.registerMany(
    Object.fromEntries(
      ChatCommands.getAllCommands(context).map(cmd => [cmd.command, cmd])
    )
  );

  registry.registerMany(
    Object.fromEntries(
      SettingsCommands.getAllCommands(context).map(cmd => [cmd.command, cmd])
    )
  );

  registry.registerMany(
    Object.fromEntries(
      FileCommands.getAllCommands(context).map(cmd => [cmd.command, cmd])
    )
  );

  registry.registerMany(
    Object.fromEntries(
      PanelCommands.getAllCommands(context).map(cmd => [cmd.command, cmd])
    )
  );

  return registry;
}

// Export all command-related classes and types
export { CommandRegistry };
export { ChatCommands };
export { SettingsCommands };
export { FileCommands };
export { PanelCommands };
export * from './types/CommandTypes';
