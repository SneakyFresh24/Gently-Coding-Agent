// =====================================================
// Plugin Manager Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PluginManager } from '../PluginManager';
import { SessionManager } from '../../session/SessionManager';
import { ToolRegistry } from '../../agent/tools/ToolRegistry';
import { Plugin, PluginManifest, PluginStatus } from '../types/PluginTypes';

// Mock VS Code API
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn()
  },
  workspace: {
    workspaceFolders: [
      {
        uri: { fsPath: '/test/workspace' },
        name: 'test-workspace'
      }
    ]
  }
}));

// Mock fs operations
vi.mock('fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([])
}));

describe('PluginManager', () => {
  let pluginManager: PluginManager;
  let mockSessionManager: SessionManager;
  let mockToolRegistry: ToolRegistry;

  beforeEach(() => {
    mockSessionManager = {
      getSession: vi.fn(),
      createSession: vi.fn(),
      updateSession: vi.fn(),
      deleteSession: vi.fn(),
      getAllSessions: vi.fn(),
      getSessionsByType: vi.fn(),
      getActiveSession: vi.fn(),
      setActiveSession: vi.fn(),
      getSessionStats: vi.fn(),
      cleanupExpiredSessions: vi.fn(),
      dispose: vi.fn(),
      getChatProvider: vi.fn(),
      getAuthProvider: vi.fn(),
      getWorkspaceProvider: vi.fn(),
      getStorage: vi.fn()
    } as any;

    mockToolRegistry = {
      register: vi.fn(),
      registerMany: vi.fn(),
      get: vi.fn(),
      getAll: vi.fn(),
      has: vi.fn(),
      clear: vi.fn(),
      getNames: vi.fn(),
      getFormattedTools: vi.fn(),
      getToolsForPrompt: vi.fn()
    } as any;

    pluginManager = new PluginManager(
      mockSessionManager,
      mockToolRegistry
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize successfully', () => {
      expect(pluginManager).toBeInstanceOf(PluginManager);
    });
  });

  describe('activatePlugin', () => {
    it('should activate a plugin successfully', async () => {
      const mockPlugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: [
          { type: 'tool.execute', description: 'Execute tools' }
        ]
      };

      await pluginManager.activatePlugin(mockPlugin, mockManifest);

      expect(mockPlugin.activate).toHaveBeenCalled();
      const pluginInfo = pluginManager.getPlugin('test-plugin');
      expect(pluginInfo).toBeDefined();
      expect(pluginInfo?.status).toBe(PluginStatus.ACTIVE);
    });

    it('should throw error when activating the same plugin twice', async () => {
      const mockPlugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: []
      };

      await pluginManager.activatePlugin(mockPlugin, mockManifest);

      await expect(
        pluginManager.activatePlugin(mockPlugin, mockManifest)
      ).rejects.toThrow('Plugin test-plugin is already activated');
    });

    it('should handle activation errors', async () => {
      const mockPlugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn().mockRejectedValue(new Error('Activation failed')),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: []
      };

      await expect(
        pluginManager.activatePlugin(mockPlugin, mockManifest)
      ).rejects.toThrow('Activation failed');

      const pluginInfo = pluginManager.getPlugin('test-plugin');
      expect(pluginInfo).toBeDefined();
      expect(pluginInfo?.status).toBe(PluginStatus.ERROR);
      expect(pluginInfo?.error).toBe('Activation failed');
    });
  });

  describe('deactivatePlugin', () => {
    it('should deactivate a plugin successfully', async () => {
      const mockPlugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: []
      };

      await pluginManager.activatePlugin(mockPlugin, mockManifest);
      await pluginManager.deactivatePlugin('test-plugin');

      expect(mockPlugin.deactivate).toHaveBeenCalled();
      expect(pluginManager.getPlugin('test-plugin')).toBeUndefined();
    });

    it('should throw error when deactivating a non-existent plugin', async () => {
      await expect(
        pluginManager.deactivatePlugin('non-existent-plugin')
      ).rejects.toThrow('Plugin non-existent-plugin is not activated');
    });
  });

  describe('getActivePlugins', () => {
    it('should return only active plugins', async () => {
      const mockPlugin1: Plugin = {
        id: 'test-plugin-1',
        name: 'Test Plugin 1',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockPlugin2: Plugin = {
        id: 'test-plugin-2',
        name: 'Test Plugin 2',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: []
      };

      await pluginManager.activatePlugin(mockPlugin1, { ...mockManifest, name: 'test-plugin-1' });
      await pluginManager.activatePlugin(mockPlugin2, { ...mockManifest, name: 'test-plugin-2' });

      // Deactivate one plugin
      await pluginManager.deactivatePlugin('test-plugin-2');

      const activePlugins = pluginManager.getActivePlugins();
      expect(activePlugins).toHaveLength(1);
      expect(activePlugins[0].plugin.id).toBe('test-plugin-1');
    });
  });

  describe('getAllPlugins', () => {
    it('should return all plugins', async () => {
      const mockPlugin: Plugin = {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        activate: vi.fn(),
        deactivate: vi.fn()
      };

      const mockManifest: PluginManifest = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        author: 'Test Author',
        entry: 'index.js',
        permissions: []
      };

      await pluginManager.activatePlugin(mockPlugin, mockManifest);

      const allPlugins = pluginManager.getAllPlugins();
      expect(allPlugins).toHaveLength(1);
      expect(allPlugins[0].plugin.id).toBe('test-plugin');
    });
  });
});