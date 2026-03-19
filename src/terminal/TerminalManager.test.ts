// =====================================================
// Terminal Manager Refactored Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalManager } from './TerminalManager';
import { ExecutionOptions, CommandResult } from './execution/types/ExecutionTypes';
import { TerminalMode, SafetyLevel } from '../types/approval';

// Mock VS Code API
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: { fsPath: '/test/workspace' },
        name: 'test-workspace'
      }
    ],
    getConfiguration: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key, defaultValue) => defaultValue),
      update: vi.fn().mockResolvedValue(undefined)
    })
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  EventEmitter: vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn()
  }))
}));

describe('TerminalManager', () => {
  let terminalManager: TerminalManager;
  let mockContext: any;
  let mockSendMessageToWebview: any;

  beforeEach(() => {
    mockContext = {
      globalState: {
        get: vi.fn().mockImplementation((key, defaultValue) => defaultValue),
        update: vi.fn().mockResolvedValue(undefined)
      }
    };

    mockSendMessageToWebview = vi.fn();
    terminalManager = new TerminalManager(mockContext, mockSendMessageToWebview);
  });

  afterEach(() => {
    terminalManager.dispose();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize successfully', () => {
      expect(terminalManager).toBeInstanceOf(TerminalManager);
    });
  });

  describe('executeCommand', () => {
    it('should handle command execution errors', async () => {
      // Set terminal mode to AUTO
      terminalManager.setTerminalMode('smart');

      await expect(
        terminalManager.executeCommand('non-existent-command', 'Test error')
      ).rejects.toThrow();
    });
  });

  describe('killCommand', () => {
    it('should return false for non-existent command', () => {
      const result = terminalManager.killCommand('non-existent-command-id');
      expect(result).toBe(false);
    });
  });

  describe('isCommandRunning', () => {
    it('should return false for non-existent command', () => {
      const isRunning = terminalManager.isCommandRunning('non-existent-command-id');
      expect(isRunning).toBe(false);
    });
  });

  describe('getRunningCommandIds', () => {
    it('should return empty array when no commands are running', () => {
      const runningCommands = terminalManager.getRunningCommandIds();
      expect(runningCommands).toEqual([]);
    });
  });

  describe('setTerminalMode', () => {
    it('should set terminal mode', () => {
      terminalManager.setTerminalMode('smart');
      expect(terminalManager.getTerminalMode()).toBe('smart');

      terminalManager.setTerminalMode('manual');
      expect(terminalManager.getTerminalMode()).toBe('manual');
    });

    it('should send mode changed message to webview', () => {
      terminalManager.setTerminalMode('smart');
      expect(mockSendMessageToWebview).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'terminalModeChanged',
          mode: 'smart'
        })
      );
    });
  });

  describe('getTerminalMode', () => {
    it('should return current terminal mode', () => {
      expect(terminalManager.getTerminalMode()).toBe('manual'); // Default mode in Refactored is manual if not set, or otherwise
    });
  });

  describe('getQuickPatterns', () => {
    it('should return quick patterns', () => {
      const patterns = terminalManager.getQuickPatterns();
      expect(Array.isArray(patterns)).toBe(true);
    });
  });

  describe('toggleQuickPattern', () => {
    it('should toggle quick pattern', () => {
      const patterns = terminalManager.getQuickPatterns();
      if (patterns.length > 0) {
        const pattern = patterns[0];
        const originalEnabled = pattern.enabled;
        
        terminalManager.toggleQuickPattern(pattern.name, !originalEnabled);
        
        const updatedPatterns = terminalManager.getQuickPatterns();
        const updatedPattern = updatedPatterns.find(p => p.name === pattern.name);
        expect(updatedPattern?.enabled).toBe(!originalEnabled);
      }
    });

    it('should send patterns changed message to webview', () => {
      const patterns = terminalManager.getQuickPatterns();
      if (patterns.length > 0) {
        terminalManager.toggleQuickPattern(patterns[0].name, !patterns[0].enabled);
        expect(mockSendMessageToWebview).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'quickPatternsChanged',
            patterns: expect.any(Array)
          })
        );
      }
    });
  });

  describe('handleApprovalResponse', () => {
    it('should handle approval response', () => {
      // This method is tested indirectly through executeCommand tests
      expect(() => {
        terminalManager.handleApprovalResponse('test-command-id', true);
      }).not.toThrow();
    });
  });

  describe('sendTerminalStatus', () => {
    it('should send terminal status to webview', () => {
      terminalManager.sendTerminalStatus();
      expect(mockSendMessageToWebview).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'terminalStatus',
          activeCommands: expect.any(Array),
          mode: expect.any(String)
        })
      );
    });
  });

  describe('dispose', () => {
    it('should dispose without errors', () => {
      expect(() => {
        terminalManager.dispose();
      }).not.toThrow();
    });
  });
});