// =====================================================
// Command Registry Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandRegistry } from './CommandRegistry';
import type { CommandContext, CommandRegistrationOptions } from './types/CommandTypes';

// Mock vscode module
vi.mock('vscode', () => ({
  commands: {
    registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() })
  }
}));

describe('CommandRegistry', () => {
  let commandRegistry: CommandRegistry;
  let mockContext: CommandContext;
  let mockRegistrationOptions: CommandRegistrationOptions;
  let consoleSpy: any;

  beforeEach(() => {
    mockContext = {
      extensionContext: {
        subscriptions: []
      },
      chatViewProvider: {},
      agentManager: {}
    } as any;

    mockRegistrationOptions = {
      context: mockContext,
      subscriptions: []
    };

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
    commandRegistry = new CommandRegistry(mockRegistrationOptions);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize successfully', () => {
      expect(commandRegistry).toBeInstanceOf(CommandRegistry);
    });

    it('should store registration options', () => {
      const registry = new CommandRegistry(mockRegistrationOptions);
      expect(registry).toBeDefined();
    });
  });

  describe('register', () => {
    it('should register a command successfully', () => {
      const mockHandler = {
        command: 'test.command',
        handler: vi.fn()
      };

      commandRegistry.register(mockHandler.command, mockHandler);

      expect(commandRegistry.isRegistered('test.command')).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Registered command: test.command')
      );
    });

    it('should add disposable to subscriptions', () => {
      const mockHandler = {
        command: 'test.command',
        handler: vi.fn()
      };

      commandRegistry.register(mockHandler.command, mockHandler);

      expect(mockRegistrationOptions.subscriptions.length).toBe(1);
    });
  });

  describe('registerMany', () => {
    it('should register multiple commands', () => {
      const mockHandlers = {
        'test.command1': { command: 'test.command1', handler: vi.fn() },
        'test.command2': { command: 'test.command2', handler: vi.fn() }
      };

      commandRegistry.registerMany(mockHandlers);

      expect(commandRegistry.isRegistered('test.command1')).toBe(true);
      expect(commandRegistry.isRegistered('test.command2')).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should unregister a command successfully', () => {
      const mockHandler = {
        command: 'test.command',
        handler: vi.fn()
      };

      commandRegistry.register(mockHandler.command, mockHandler);
      expect(commandRegistry.isRegistered('test.command')).toBe(true);

      const result = commandRegistry.unregister('test.command');
      expect(result).toBe(true);
      expect(commandRegistry.isRegistered('test.command')).toBe(false);
    });

    it('should return false for non-existent command', () => {
      const result = commandRegistry.unregister('non.existent.command');
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute a command successfully', async () => {
      const mockHandler = vi.fn();
      const command = {
        command: 'test.command',
        handler: mockHandler
      };

      commandRegistry.register(command.command, command);
      await commandRegistry.execute('test.command', 'arg1', 'arg2');

      expect(mockHandler).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should throw error for non-existent command', async () => {
      await expect(
        commandRegistry.execute('non.existent.command')
      ).rejects.toThrow('Command not found: non.existent.command');
    });

    it('should handle command execution errors', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('Test error'));
      const command = {
        command: 'test.command',
        handler: mockHandler
      };

      commandRegistry.register(command.command, command);

      await expect(
        commandRegistry.execute('test.command')
      ).rejects.toThrow('Test error');
    });
  });

  describe('getAllCommands', () => {
    it('should return all registered command names', () => {
      const mockHandlers = {
        'test.command1': { command: 'test.command1', handler: vi.fn() },
        'test.command2': { command: 'test.command2', handler: vi.fn() }
      };

      commandRegistry.registerMany(mockHandlers);
      const commands = commandRegistry.getAllCommands();

      expect(commands).toHaveLength(2);
      expect(commands).toContain('test.command1');
      expect(commands).toContain('test.command2');
    });

    it('should return empty array when no commands are registered', () => {
      const commands = commandRegistry.getAllCommands();
      expect(commands).toEqual([]);
    });
  });

  describe('isRegistered', () => {
    it('should return true for registered command', () => {
      const mockHandler = {
        command: 'test.command',
        handler: vi.fn()
      };

      commandRegistry.register(mockHandler.command, mockHandler);
      expect(commandRegistry.isRegistered('test.command')).toBe(true);
    });

    it('should return false for non-existent command', () => {
      expect(commandRegistry.isRegistered('non.existent.command')).toBe(false);
    });
  });

  describe('getHandler', () => {
    it('should return registered handler', () => {
      const mockHandler = {
        command: 'test.command',
        handler: vi.fn()
      };

      commandRegistry.register(mockHandler.command, mockHandler);
      const handler = commandRegistry.getHandler('test.command');

      expect(handler).toEqual(mockHandler);
    });

    it('should return undefined for non-existent command', () => {
      const handler = commandRegistry.getHandler('non.existent.command');
      expect(handler).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all registered commands', () => {
      const mockHandlers = {
        'test.command1': { command: 'test.command1', handler: vi.fn() },
        'test.command2': { command: 'test.command2', handler: vi.fn() }
      };

      commandRegistry.registerMany(mockHandlers);
      expect(commandRegistry.getAllCommands()).toHaveLength(2);

      commandRegistry.clear();
      expect(commandRegistry.getAllCommands()).toHaveLength(0);
    });
  });
});