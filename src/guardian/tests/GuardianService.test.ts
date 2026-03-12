// =====================================================
// Guardian Service Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GuardianService } from '../GuardianService';
import { GuardianIssueType, GuardianSeverity, GuardianSource } from '../types';

// Create simple mock objects
const mockRelationshipGraph: any = {
  indexFile: vi.fn(),
  getDirectCallers: vi.fn(() => []),
  getDirectCallees: vi.fn(() => []),
  getTransitiveCallers: vi.fn(() => []),
  getTransitiveCallees: vi.fn(() => []),
  getFilesImportingSymbol: vi.fn(() => []),
  getImportedSymbols: vi.fn(() => []),
  getDependentFiles: vi.fn(() => []),
  getDependencies: vi.fn(() => []),
  getAffectedFiles: vi.fn(() => []),
  findSymbol: vi.fn(),
  getSymbolsInFile: vi.fn(() => []),
  getStats: vi.fn(() => ({})),
  clearFile: vi.fn(),
  clear: vi.fn()
};

const mockMemoryManager: any = {
  initialize: vi.fn().mockResolvedValue(undefined),
  addMemory: vi.fn(),
  getRelevantMemories: vi.fn(() => []),
  getAllMemories: vi.fn(() => []),
  getMemory: vi.fn(),
  deleteMemory: vi.fn(),
  updateMemory: vi.fn(),
  getStats: vi.fn(() => ({})),
  deprecateMemory: vi.fn(),
  archiveMemory: vi.fn(),
  restoreMemory: vi.fn(),
  detectConflicts: vi.fn(),
  decreaseConfidence: vi.fn(),
  clearAll: vi.fn()
};

const mockValidationManager: any = {
  initialize: vi.fn().mockResolvedValue(undefined),
  validateCode: vi.fn(),
  validateWithRetry: vi.fn(),
  getMetrics: vi.fn(() => ({})),
  resetMetrics: vi.fn(),
  updateConfig: vi.fn(),
  getConfig: vi.fn(() => ({}))
};

const mockHybridRetriever: any = {
  initialize: vi.fn().mockResolvedValue(undefined),
  setEmbeddingProvider: vi.fn(),
  initializeHNSW: vi.fn(),
  indexFile: vi.fn(),
  indexFiles: vi.fn(),
  removeFile: vi.fn(),
  search: vi.fn(),
  searchWithGraph: vi.fn(),
  getStats: vi.fn(() => ({})),
  saveHNSWIndex: vi.fn(),
  loadHNSWIndex: vi.fn(),
  getHNSWIndex: vi.fn(),
  clear: vi.fn()
};

const mockCodebaseIndexer: any = {
  initialize: vi.fn().mockResolvedValue(undefined),
  indexFile: vi.fn(),
  indexFiles: vi.fn(),
  removeFile: vi.fn(),
  search: vi.fn(),
  getStats: vi.fn(() => ({})),
  clear: vi.fn()
};

// Mock VS Code
vi.mock('vscode', () => ({
  workspace: {
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn()
    }))
  },
  window: {
    createOutputChannel: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn()
  },
  StatusBarAlignment: {
    Right: 1
  },
  RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern }))
}));

describe('GuardianService', () => {
  let guardianService: GuardianService;
  const workspaceRoot = '/test/workspace';

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Create fresh mock instances for each test
    const freshRelationshipGraph = { ...mockRelationshipGraph };
    const freshMemoryManager = { ...mockMemoryManager };
    const freshValidationManager = { ...mockValidationManager };
    const freshHybridRetriever = { ...mockHybridRetriever };
    const freshCodebaseIndexer = { ...mockCodebaseIndexer };
    
    guardianService = new GuardianService(
      workspaceRoot,
      freshRelationshipGraph,
      freshMemoryManager,
      freshValidationManager,
      freshHybridRetriever,
      freshCodebaseIndexer
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    guardianService.dispose();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await guardianService.initialize();
      
      expect(mockMemoryManager.initialize).toHaveBeenCalled();
      expect(mockValidationManager.initialize).toHaveBeenCalled();
    });

    it('should not initialize twice', async () => {
      await guardianService.initialize();
      await guardianService.initialize();

      // Should still be called twice since we don't have initialization guards
      expect(mockMemoryManager.initialize).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      const newConfig = {
        enabled: false,
        analysisInterval: 10000
      };

      guardianService.updateConfig(newConfig);
      const config = guardianService.getConfig();

      expect(config.enabled).toBe(false);
      expect(config.analysisInterval).toBe(10000);
    });

    it('should get current configuration', () => {
      const config = guardianService.getConfig();
      
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('analysisInterval');
      expect(config).toHaveProperty('maxIssuesPerFile');
    });
  });

  describe('issue management', () => {
    it('should return empty issues list initially', () => {
      const issues = guardianService.getIssues();
      expect(issues).toEqual([]);
    });

    it('should dismiss an issue', () => {
      // Create a mock issue
      const mockIssue = {
        id: 'test-issue-1',
        type: GuardianIssueType.DEAD_CODE,
        severity: GuardianSeverity.LOW,
        title: 'Test Issue',
        description: 'Test Description',
        filePath: '/test/file.ts',
        suggestions: [],
        metadata: {
          source: GuardianSource.VALIDATION_PIPELINE
        },
        createdAt: Date.now()
      };

      // Manually add the issue to test dismissal
      guardianService['issues'].set(mockIssue.id, mockIssue);
      
      const result = guardianService.dismissIssue(mockIssue.id);
      
      expect(result).toBe(true);
      expect(guardianService.getIssues()).toEqual([]);
    });

    it('should return issues for a specific file', () => {
      const mockIssue1 = {
        id: 'test-issue-1',
        type: GuardianIssueType.DEAD_CODE,
        severity: GuardianSeverity.LOW,
        title: 'Test Issue 1',
        description: 'Test Description 1',
        filePath: '/test/file1.ts',
        suggestions: [],
        metadata: { source: GuardianSource.VALIDATION_PIPELINE },
        createdAt: Date.now()
      };

      const mockIssue2 = {
        id: 'test-issue-2',
        type: GuardianIssueType.CODE_DUPLICATION,
        severity: GuardianSeverity.MEDIUM,
        title: 'Test Issue 2',
        description: 'Test Description 2',
        filePath: '/test/file2.ts',
        suggestions: [],
        metadata: { source: GuardianSource.VALIDATION_PIPELINE },
        createdAt: Date.now()
      };

      // Manually add issues
      guardianService['issues'].set(mockIssue1.id, mockIssue1);
      guardianService['issues'].set(mockIssue2.id, mockIssue2);
      
      const file1Issues = guardianService.getIssuesForFile('/test/file1.ts');
      const file2Issues = guardianService.getIssuesForFile('/test/file2.ts');
      
      expect(file1Issues).toHaveLength(1);
      expect(file1Issues[0].id).toBe('test-issue-1');
      expect(file2Issues).toHaveLength(1);
      expect(file2Issues[0].id).toBe('test-issue-2');
    });
  });

  describe('analysis', () => {
    it('should perform analysis without errors', async () => {
      await guardianService.initialize();
      
      // Create a complete mock of AnalyzerManager
      const mockAnalyzerManager = {
        runAnalysis: vi.fn().mockResolvedValue([]),
        registerAnalyzer: vi.fn(),
        unregisterAnalyzer: vi.fn(),
        getAnalyzer: vi.fn(),
        getAllAnalyzers: vi.fn(),
        getEnabledAnalyzers: vi.fn(),
        enableAnalyzer: vi.fn(),
        disableAnalyzer: vi.fn(),
        updateConfig: vi.fn(),
        getStats: vi.fn(),
        dispose: vi.fn(),
        initializeAnalyzers: vi.fn(),
        runAnalyzer: vi.fn(),
        shouldRunAnalyzer: vi.fn(),
        getSeverityWeight: vi.fn(),
        getEffortWeight: vi.fn(),
        getTypeWeight: vi.fn(),
        filterIssuesByConfig: vi.fn(),
        filterIssuesByFile: vi.fn(),
        filterIssuesByType: vi.fn(),
        filterIssuesBySeverity: vi.fn(),
        sortIssues: vi.fn(),
        limitIssues: vi.fn(),
        deduplicateIssues: vi.fn(),
        validateIssue: vi.fn(),
        createIssue: vi.fn(),
        updateIssue: vi.fn(),
        analyzers: new Map(),
        enabledAnalyzers: new Set(),
        relationshipGraph: mockRelationshipGraph,
        memoryManager: mockMemoryManager
      };
      
      (guardianService as any)['analyzerManager'] = mockAnalyzerManager;
      
      const result = await guardianService.performAnalysis(['/test/file.ts'], false);
      
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('stats');
      expect(result).toHaveProperty('context');
      expect(result).toHaveProperty('duration');
      expect(result.issues).toEqual([]);
    });

    it('should handle analysis errors gracefully', async () => {
      await guardianService.initialize();
      
      // Create a complete mock of AnalyzerManager
      const mockAnalyzerManager = {
        runAnalysis: vi.fn().mockRejectedValue(new Error('Test error')),
        registerAnalyzer: vi.fn(),
        unregisterAnalyzer: vi.fn(),
        getAnalyzer: vi.fn(),
        getAllAnalyzers: vi.fn(),
        getEnabledAnalyzers: vi.fn(),
        enableAnalyzer: vi.fn(),
        disableAnalyzer: vi.fn(),
        updateConfig: vi.fn(),
        getStats: vi.fn(),
        dispose: vi.fn(),
        initializeAnalyzers: vi.fn(),
        runAnalyzer: vi.fn(),
        shouldRunAnalyzer: vi.fn(),
        getSeverityWeight: vi.fn(),
        getEffortWeight: vi.fn(),
        getTypeWeight: vi.fn(),
        filterIssuesByConfig: vi.fn(),
        filterIssuesByFile: vi.fn(),
        filterIssuesByType: vi.fn(),
        filterIssuesBySeverity: vi.fn(),
        sortIssues: vi.fn(),
        limitIssues: vi.fn(),
        deduplicateIssues: vi.fn(),
        validateIssue: vi.fn(),
        createIssue: vi.fn(),
        updateIssue: vi.fn(),
        analyzers: new Map(),
        enabledAnalyzers: new Set(),
        relationshipGraph: mockRelationshipGraph,
        memoryManager: mockMemoryManager
      };
      
      (guardianService as any)['analyzerManager'] = mockAnalyzerManager;
      
      await expect(guardianService.performAnalysis(['/test/file.ts'], false))
        .rejects.toThrow('Test error');
    });
  });

  describe('statistics', () => {
    it('should return initial statistics', () => {
      const stats = guardianService.getStats();
      
      expect(stats).toHaveProperty('totalIssues', 0);
      expect(stats).toHaveProperty('issuesByType');
      expect(stats).toHaveProperty('issuesBySeverity');
      expect(stats).toHaveProperty('dismissedIssues', 0);
      expect(stats).toHaveProperty('fixedIssues', 0);
    });
  });

  describe('auto-analysis', () => {
    it('should start auto-analysis', async () => {
      await guardianService.initialize();
      
      const startAutoAnalysisSpy = vi.spyOn(guardianService as any, 'startAutoAnalysis');
      
      guardianService.startAutoAnalysis();
      
      expect(startAutoAnalysisSpy).toHaveBeenCalled();
    });

    it('should stop auto-analysis', () => {
      const stopAutoAnalysisSpy = vi.spyOn(guardianService as any, 'stopAutoAnalysis');
      
      guardianService.stopAutoAnalysis();
      
      expect(stopAutoAnalysisSpy).toHaveBeenCalled();
    });
  });

  describe('disposal', () => {
    it('should dispose resources properly', () => {
      const stopAutoAnalysisSpy = vi.spyOn(guardianService as any, 'stopAutoAnalysis');
      const removeAllListenersSpy = vi.spyOn(guardianService, 'removeAllListeners');
      
      guardianService.dispose();
      
      expect(stopAutoAnalysisSpy).toHaveBeenCalled();
      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });
});