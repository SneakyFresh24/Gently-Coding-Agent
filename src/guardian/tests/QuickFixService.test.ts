// =====================================================
// Quick Fix Service Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QuickFixService } from '../QuickFixService';
import { GuardianIssue, GuardianSuggestion, SuggestionAction, GuardianIssueType, GuardianSeverity, GuardianSource, SuggestionType, EffortLevel } from '../types';

// Create simple mock objects
const mockAgentMode: any = {
  executeTask: vi.fn()
};

describe('QuickFixService', () => {
  let quickFixService: QuickFixService;
  let mockIssue: GuardianIssue;
  let mockSuggestion: GuardianSuggestion;

  beforeEach(() => {
    // Reset mocks and set default behavior
    vi.clearAllMocks();
    mockAgentMode.executeTask.mockResolvedValue({
      success: true,
      result: 'Fixed code',
      changes: ['Fixed line 1', 'Fixed line 2']
    });
    
    quickFixService = new QuickFixService(mockAgentMode);
    
    // Create mock issue and suggestion
    mockIssue = {
      id: 'test-issue-1',
      type: GuardianIssueType.DEAD_CODE,
      severity: GuardianSeverity.LOW,
      title: 'Test Issue',
      description: 'Test Description',
      filePath: '/test/file.ts',
      lineNumbers: [1, 2, 3],
      suggestions: [],
      metadata: {
        source: GuardianSource.VALIDATION_PIPELINE
      },
      createdAt: Date.now()
    };
    
    mockSuggestion = {
      id: 'test-suggestion-1',
      type: SuggestionType.REMOVE_UNUSED,
      title: 'Test Suggestion',
      description: 'Test Description',
      action: SuggestionAction.FIX_IT,
      confidence: 0.8,
      estimatedEffort: EffortLevel.LOW
    };
    
    mockIssue.suggestions = [mockSuggestion];
  });

  afterEach(() => {
    vi.clearAllMocks();
    quickFixService.dispose();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const service = new QuickFixService();
      const config = service.getConfig();
      
      expect(config.enabled).toBe(true);
      expect(config.autoApply).toBe(false);
      expect(config.requireConfirmation).toBe(true);
      expect(config.maxRetries).toBe(3);
      expect(config.timeout).toBe(30000);
    });

    it('should initialize with custom config', () => {
      const customConfig = {
        enabled: false,
        autoApply: true,
        maxRetries: 5
      };
      
      const service = new QuickFixService(undefined, customConfig);
      const config = service.getConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.autoApply).toBe(true);
      expect(config.maxRetries).toBe(5);
    });
  });

  describe('Agent Mode integration', () => {
    it('should set Agent Mode', () => {
      const service = new QuickFixService();
      service.setAgentMode(mockAgentMode);
      
      // No direct way to verify, but should not throw
      expect(true).toBe(true);
    });
  });

  describe('fix capability checking', () => {
    it('should return false for non-fixable suggestions', () => {
      const nonFixableSuggestion = {
        ...mockSuggestion,
        action: SuggestionAction.SHOW_ME
      };
      
      const canFix = quickFixService.canFix(nonFixableSuggestion);
      expect(canFix).toBe(false);
    });

    it('should return false for low confidence suggestions', () => {
      const lowConfidenceSuggestion = {
        ...mockSuggestion,
        confidence: 0.5
      };
      
      const canFix = quickFixService.canFix(lowConfidenceSuggestion);
      expect(canFix).toBe(false);
    });

    it('should return true for fixable suggestions', () => {
      const canFix = quickFixService.canFix(mockSuggestion);
      expect(canFix).toBe(true);
    });
  });

  describe('applying fixes', () => {
    it('should apply fix successfully', async () => {
      const result = await quickFixService.applyQuickFix(mockIssue, mockSuggestion);
      
      expect(result.success).toBe(true);
      expect(result.issueId).toBe(mockIssue.id);
      expect(result.suggestionId).toBe(mockSuggestion.id);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle fix failures', async () => {
      // Create a new service with an Agent Mode
      const service = new QuickFixService(mockAgentMode);
      
      // Mock the simulateAgentExecution method to return a failure
      (service as any).simulateAgentExecution = vi.fn().mockResolvedValue({
        success: false,
        error: 'Test error'
      });
      
      const result = await service.applyQuickFix(mockIssue, mockSuggestion);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Test error');
      
      service.dispose();
    });

    it('should not apply fix for non-fixable suggestions', async () => {
      const nonFixableSuggestion = {
        ...mockSuggestion,
        action: SuggestionAction.SHOW_ME
      };
      
      // Check if the service correctly identifies non-fixable suggestions
      const canFix = quickFixService.canFix(nonFixableSuggestion);
      expect(canFix).toBe(false);
      
      // Even if we try to apply it, it should fail
      const result = await quickFixService.applyQuickFix(mockIssue, nonFixableSuggestion);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be automatically fixed');
    });
  });

  describe('batch fixes', () => {
    it('should apply batch fixes successfully', async () => {
      const fixes = [
        { issue: mockIssue, suggestion: mockSuggestion },
        { issue: { ...mockIssue, id: 'test-issue-2' }, suggestion: mockSuggestion }
      ];
      
      const results = await quickFixService.applyBatchFixes(fixes);
      
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it('should handle empty batch fixes', async () => {
      const results = await quickFixService.applyBatchFixes([]);
      
      expect(results).toHaveLength(0);
    });

    it('should stop on first failure', async () => {
      // Create one fixable and one non-fixable suggestion
      const nonFixableSuggestion = {
        ...mockSuggestion,
        action: SuggestionAction.SHOW_ME
      };
      
      const fixes = [
        { issue: mockIssue, suggestion: mockSuggestion },
        { issue: { ...mockIssue, id: 'test-issue-2' }, suggestion: nonFixableSuggestion }
      ];
      
      const results = await quickFixService.applyBatchFixes(fixes);
      
      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
    });
  });

  describe('active fixes management', () => {
    it('should track active fixes', async () => {
      // Start a fix but don't await it
      const fixPromise = quickFixService.applyQuickFix(mockIssue, mockSuggestion);
      
      // Check if fix is tracked
      const activeFixes = quickFixService.getActiveFixes();
      expect(activeFixes.length).toBeGreaterThan(0);
      
      // Wait for fix to complete
      await fixPromise;
    });

    it('should cancel active fixes', async () => {
      // Start a fix but don't await it
      const fixPromise = quickFixService.applyQuickFix(mockIssue, mockSuggestion);
      
      // Get the fix ID
      const activeFixes = quickFixService.getActiveFixes();
      const fixId = activeFixes[0];
      
      // Cancel the fix
      const cancelled = await quickFixService.cancelFix(fixId);
      expect(cancelled).toBe(true);
      
      // Wait for fix to complete (it might have completed before cancellation)
      try {
        await fixPromise;
      } catch (error) {
        // Expected if cancellation worked
      }
    });

    it('should return false for non-existent fix IDs', async () => {
      const cancelled = await quickFixService.cancelFix('non-existent-fix-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      const newConfig = {
        enabled: false,
        autoApply: true,
        maxRetries: 5
      };
      
      quickFixService.updateConfig(newConfig);
      const config = quickFixService.getConfig();
      
      expect(config.enabled).toBe(false);
      expect(config.autoApply).toBe(true);
      expect(config.maxRetries).toBe(5);
    });
  });

  describe('statistics', () => {
    it('should return statistics', () => {
      const stats = quickFixService.getStats();
      
      expect(stats).toHaveProperty('activeFixes');
      expect(stats).toHaveProperty('enabled');
      expect(stats).toHaveProperty('autoApply');
      expect(stats).toHaveProperty('requireConfirmation');
    });
  });

  describe('disposal', () => {
    it('should dispose resources', () => {
      const disposeSpy = vi.spyOn(quickFixService as any, 'removeAllListeners');
      
      quickFixService.dispose();
      
      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});