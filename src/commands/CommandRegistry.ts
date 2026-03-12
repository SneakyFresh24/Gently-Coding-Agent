// =====================================================
// Command Registry - Central command registration
// =====================================================

import * as vscode from 'vscode';
import { CommandHandler, CommandRegistrationOptions } from './types/CommandTypes';

/**
 * Central registry for all extension commands
 */
export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map();
  private context: CommandRegistrationOptions;

  constructor(context: CommandRegistrationOptions) {
    this.context = context;
  }

  /**
   * Register a command with VS Code
   */
  register(command: string, handler: CommandHandler): void {
    // Store handler for potential later use
    this.handlers.set(command, handler);

    // Register with VS Code
    const disposable = vscode.commands.registerCommand(command, handler.handler);
    this.context.subscriptions.push(disposable);

    console.log(`[CommandRegistry] Registered command: ${command}`);
  }

  /**
   * Register multiple commands
   */
  registerMany(commands: Record<string, CommandHandler>): void {
    Object.entries(commands).forEach(([command, handler]) => {
      this.register(command, handler);
    });
  }

  /**
   * Unregister a command
   */
  unregister(command: string): boolean {
    if (this.handlers.has(command)) {
      this.handlers.delete(command);
      console.log(`[CommandRegistry] Unregistered command: ${command}`);
      return true;
    }
    return false;
  }

  /**
   * Execute a command programmatically
   */
  async execute(command: string, ...args: any[]): Promise<void> {
    const handler = this.handlers.get(command);
    if (!handler) {
      throw new Error(`Command not found: ${command}`);
    }

    try {
      await handler.handler(...args);
    } catch (error) {
      console.error(`[CommandRegistry] Error executing command ${command}:`, error);
      throw error;
    }
  }

  /**
   * Check if a command is registered
   */
  isRegistered(command: string): boolean {
    return this.handlers.has(command);
  }

  /**
   * Get all registered command names
   */
  getAllCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get command handler (for testing)
   */
  getHandler(command: string): CommandHandler | undefined {
    return this.handlers.get(command);
  }

  /**
   * Clear all commands (for testing)
   */
  clear(): void {
    this.handlers.clear();
  }
}