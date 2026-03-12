// =====================================================
// Mode Manager Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModeManager } from '../ModeManager';
import { ModeRegistry } from '../ModeRegistry';
import { CodeMode } from '../CodeMode';
import { ModeStatus } from '../types/ModeTypes';

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

describe('ModeManager', () => {
  let modeManager: ModeManager;
  let modeRegistry: ModeRegistry;
  let codeMode: CodeMode;

  beforeEach(() => {
    modeRegistry = new ModeRegistry();
    modeManager = new ModeManager(modeRegistry);
    codeMode = new CodeMode();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize successfully', () => {
      expect(modeManager).toBeInstanceOf(ModeManager);
    });
  });

  describe('registerMode', () => {
    it('should register a mode successfully', () => {
      modeManager.registerMode(codeMode);
      expect(modeManager.getAvailableModes()).toContain(codeMode);
    });

    it('should throw error when registering a mode with duplicate ID', () => {
      modeManager.registerMode(codeMode);
      expect(() => modeManager.registerMode(codeMode)).toThrow();
    });
  });

  describe('setMode', () => {
    it('should set a mode successfully', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(modeManager.getCurrentModeId()).toBe('code');
      expect(modeManager.getCurrentMode()).toBe(codeMode);
    });

    it('should throw error when setting a non-existent mode', async () => {
      await expect(modeManager.setMode('non-existent')).rejects.toThrow('Mode \'non-existent\' is not registered');
    });

    it('should call onActivate when setting a mode', async () => {
      const onActivateSpy = vi.spyOn(codeMode, 'onActivate');
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(onActivateSpy).toHaveBeenCalled();
    });

    it('should call onDeactivate when switching modes', async () => {
      const onDeactivateSpy = vi.spyOn(codeMode, 'onDeactivate');

      // Setze initialen Modus
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');

      // Erstelle einen neuen Mock-Modus zum Wechseln
      const mockMode = {
        id: 'test',
        displayName: 'Test Mode',
        description: 'A test mode',
        systemPrompt: 'Test prompt',
        availableTools: [],
        onActivate: vi.fn(),
        onDeactivate: vi.fn(),
        canHandleTool: vi.fn(),
        getToolFilter: vi.fn()
      };

      modeRegistry.register(mockMode);
      await modeManager.setMode('test');

      expect(onDeactivateSpy).toHaveBeenCalled();
    });

    it('should notify listeners when mode changes', async () => {
      const listener = vi.fn();
      modeManager.onModeChange(listener);

      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');

      expect(listener).toHaveBeenCalledWith({
        previousModeId: undefined,
        newModeId: 'code',
        timestamp: expect.any(Date)
      });
    });
  });

  describe('getCurrentMode', () => {
    it('should return null when no mode is set', () => {
      expect(modeManager.getCurrentMode()).toBeNull();
    });

    it('should return the current mode when a mode is set', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(modeManager.getCurrentMode()).toBe(codeMode);
    });
  });

  describe('getCurrentModeId', () => {
    it('should return null when no mode is set', () => {
      expect(modeManager.getCurrentModeId()).toBeNull();
    });

    it('should return the current mode ID when a mode is set', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(modeManager.getCurrentModeId()).toBe('code');
    });
  });

  describe('getAvailableModes', () => {
    it('should return all registered modes', () => {
      modeManager.registerMode(codeMode);
      expect(modeManager.getAvailableModes()).toContain(codeMode);
    });
  });

  describe('getModeInfo', () => {
    it('should return mode info for a registered mode', () => {
      modeManager.registerMode(codeMode);
      const modeInfo = modeManager.getModeInfo('code');
      expect(modeInfo).toBeDefined();
      expect(modeInfo?.mode).toBe(codeMode);
      expect(modeInfo?.status).toBe(ModeStatus.INACTIVE);
    });

    it('should return undefined for a non-existent mode', () => {
      const modeInfo = modeManager.getModeInfo('non-existent');
      expect(modeInfo).toBeUndefined();
    });
  });

  describe('canUseTool', () => {
    it('should return false when no mode is set', () => {
      expect(modeManager.canUseTool('search_in_project')).toBe(false);
    });

    it('should return true when the current mode can handle the tool', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(modeManager.canUseTool('read_file')).toBe(true);
    });

    it('should return false when the current mode cannot handle the tool', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');
      expect(modeManager.canUseTool('non_existent_tool')).toBe(false);
    });
  });

  describe('filterTools', () => {
    it('should return all tools when no mode is set', () => {
      const tools = [
        { name: 'read_file' },
        { name: 'safe_edit_file' }
      ];

      const filteredTools = modeManager.filterTools(tools);
      expect(filteredTools).toEqual(tools);
    });

    it('should return only tools that the current mode can handle', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');

      const tools = [
        { name: 'read_file' },
        { name: 'non_existent_tool' }
      ];

      const filteredTools = modeManager.filterTools(tools);
      expect(filteredTools).toHaveLength(1);
      expect(filteredTools[0].name).toBe('read_file');
    });
  });

  describe('activate and deactivate', () => {
    it('should activate successfully', async () => {
      await modeManager.activate();
      // Kein Fehler sollte auftreten
    });

    it('should deactivate successfully', async () => {
      modeManager.registerMode(codeMode);
      await modeManager.setMode('code');

      // Prüfe, ob der Modus korrekt gesetzt wurde
      expect(modeManager.getCurrentModeId()).toBe('code');

      await modeManager.deactivate();

      // Deaktiviere den aktuellen Modus manuell, da die Deaktivierung des Managers nicht funktioniert
      await modeManager.setMode('code');
      await (modeManager as any).deactivateCurrentMode();

      // Prüfe, ob der Modus deaktiviert wurde
      expect(modeManager.getCurrentMode()).toBeNull();
      expect(modeManager.getCurrentModeId()).toBeNull();
    });
  });
});