// =====================================================
// Guardian Analyzers Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GuardianAnalysisContext } from '../types';

// Create simple mock objects
const mockRelationshipGraph: any = {
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
  getStats: vi.fn(() => ({}))
};

const mockMemoryManager: any = {
  getRelevantMemories: vi.fn(() => []),
  getAllMemories: vi.fn(() => []),
  getMemory: vi.fn(),
  deleteMemory: vi.fn(),
  updateMemory: vi.fn(),
  getStats: vi.fn(() => ({})),
  deprecateMemory: vi.fn(),
  archiveMemory: vi.fn(),
  restoreMemory: vi.fn()
};

describe('Guardian Analyzers', () => {
  let context: GuardianAnalysisContext;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    context = {
      workspaceRoot: '/test',
      changedFiles: [],
      fullAnalysis: false,
      timestamp: Date.now()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CodeDuplicationAnalyzer', () => {
    it('should be initialized with correct properties', async () => {
      const { CodeDuplicationAnalyzer } = await import('../analyzers/CodeDuplicationAnalyzer');
      const analyzer = new CodeDuplicationAnalyzer(mockRelationshipGraph);
      
      expect(analyzer.id).toBe('code-duplication');
      expect(analyzer.name).toBe('Code Duplication Analyzer');
      expect(analyzer.description).toContain('duplicated code');
    });

    it('should return empty issues for empty context', async () => {
      const { CodeDuplicationAnalyzer } = await import('../analyzers/CodeDuplicationAnalyzer');
      const analyzer = new CodeDuplicationAnalyzer(mockRelationshipGraph);
      
      const issues = await analyzer.analyze(context);
      expect(issues).toEqual([]);
    });

    it('should be enabled by default', async () => {
      const { CodeDuplicationAnalyzer } = await import('../analyzers/CodeDuplicationAnalyzer');
      const analyzer = new CodeDuplicationAnalyzer(mockRelationshipGraph);
      expect(analyzer.isEnabled()).toBe(true);
    });

    it('should toggle enabled state', async () => {
      const { CodeDuplicationAnalyzer } = await import('../analyzers/CodeDuplicationAnalyzer');
      const analyzer = new CodeDuplicationAnalyzer(mockRelationshipGraph);
      
      analyzer.setEnabled(false);
      expect(analyzer.isEnabled()).toBe(false);

      analyzer.setEnabled(true);
      expect(analyzer.isEnabled()).toBe(true);
    });
  });

  describe('DeadCodeAnalyzer', () => {
    it('should be initialized with correct properties', async () => {
      const { DeadCodeAnalyzer } = await import('../analyzers/DeadCodeAnalyzer');
      const analyzer = new DeadCodeAnalyzer(mockRelationshipGraph);
      
      expect(analyzer.id).toBe('dead-code');
      expect(analyzer.name).toBe('Dead Code Analyzer');
      expect(analyzer.description).toContain('unused');
    });

    it('should return empty issues for empty context', async () => {
      const { DeadCodeAnalyzer } = await import('../analyzers/DeadCodeAnalyzer');
      const analyzer = new DeadCodeAnalyzer(mockRelationshipGraph);
      
      const issues = await analyzer.analyze(context);
      expect(issues).toEqual([]);
    });

    it('should be enabled by default', async () => {
      const { DeadCodeAnalyzer } = await import('../analyzers/DeadCodeAnalyzer');
      const analyzer = new DeadCodeAnalyzer(mockRelationshipGraph);
      expect(analyzer.isEnabled()).toBe(true);
    });
  });

  describe('SecurityPatternAnalyzer', () => {
    it('should be initialized with correct properties', async () => {
      const { SecurityPatternAnalyzer } = await import('../analyzers/SecurityPatternAnalyzer');
      const analyzer = new SecurityPatternAnalyzer();
      
      expect(analyzer.id).toBe('security-patterns');
      expect(analyzer.name).toBe('Security Pattern Analyzer');
      expect(analyzer.description).toContain('security');
    });

    it('should return empty issues for empty context', async () => {
      const { SecurityPatternAnalyzer } = await import('../analyzers/SecurityPatternAnalyzer');
      const analyzer = new SecurityPatternAnalyzer();
      
      const issues = await analyzer.analyze(context);
      expect(issues).toEqual([]);
    });

    it('should be enabled by default', async () => {
      const { SecurityPatternAnalyzer } = await import('../analyzers/SecurityPatternAnalyzer');
      const analyzer = new SecurityPatternAnalyzer();
      expect(analyzer.isEnabled()).toBe(true);
    });

    it('should allow adding custom security patterns', async () => {
      const { SecurityPatternAnalyzer } = await import('../analyzers/SecurityPatternAnalyzer');
      const analyzer = new SecurityPatternAnalyzer();
      const initialPatterns = analyzer.getSecurityPatterns();
      const initialCount = initialPatterns.length;

      analyzer.addSecurityPattern({
        name: 'test-pattern',
        pattern: /test_pattern/,
        severity: 'medium' as any,
        title: 'Test Pattern',
        description: 'Test Description',
        recommendation: 'Test Recommendation'
      });

      const updatedPatterns = analyzer.getSecurityPatterns();
      expect(updatedPatterns).toHaveLength(initialCount + 1);
    });

    it('should allow removing security patterns', async () => {
      const { SecurityPatternAnalyzer } = await import('../analyzers/SecurityPatternAnalyzer');
      const analyzer = new SecurityPatternAnalyzer();
      
      analyzer.addSecurityPattern({
        name: 'test-pattern',
        pattern: /test_pattern/,
        severity: 'medium' as any,
        title: 'Test Pattern',
        description: 'Test Description',
        recommendation: 'Test Recommendation'
      });

      const result = analyzer.removeSecurityPattern('test-pattern');
      expect(result).toBe(true);

      const result2 = analyzer.removeSecurityPattern('non-existent');
      expect(result2).toBe(false);
    });
  });

  describe('PerformanceAnalyzer', () => {
    it('should be initialized with correct properties', async () => {
      const { PerformanceAnalyzer } = await import('../analyzers/PerformanceAnalyzer');
      const analyzer = new PerformanceAnalyzer();
      
      expect(analyzer.id).toBe('performance');
      expect(analyzer.name).toBe('Performance Analyzer');
      expect(analyzer.description).toContain('performance');
    });

    it('should return empty issues for empty context', async () => {
      const { PerformanceAnalyzer } = await import('../analyzers/PerformanceAnalyzer');
      const analyzer = new PerformanceAnalyzer();
      
      const issues = await analyzer.analyze(context);
      expect(issues).toEqual([]);
    });

    it('should be enabled by default', async () => {
      const { PerformanceAnalyzer } = await import('../analyzers/PerformanceAnalyzer');
      const analyzer = new PerformanceAnalyzer();
      expect(analyzer.isEnabled()).toBe(true);
    });

    it('should allow adding custom performance patterns', async () => {
      const { PerformanceAnalyzer } = await import('../analyzers/PerformanceAnalyzer');
      const analyzer = new PerformanceAnalyzer();
      const initialPatterns = analyzer.getPerformancePatterns();
      const initialCount = initialPatterns.length;

      analyzer.addPerformancePattern({
        name: 'test-pattern',
        pattern: /test_pattern/,
        severity: 'medium' as any,
        title: 'Test Pattern',
        description: 'Test Description',
        recommendation: 'Test Recommendation'
      });

      const updatedPatterns = analyzer.getPerformancePatterns();
      expect(updatedPatterns).toHaveLength(initialCount + 1);
    });

    it('should allow removing performance patterns', async () => {
      const { PerformanceAnalyzer } = await import('../analyzers/PerformanceAnalyzer');
      const analyzer = new PerformanceAnalyzer();
      
      analyzer.addPerformancePattern({
        name: 'test-pattern',
        pattern: /test_pattern/,
        severity: 'medium' as any,
        title: 'Test Pattern',
        description: 'Test Description',
        recommendation: 'Test Recommendation'
      });

      const result = analyzer.removePerformancePattern('test-pattern');
      expect(result).toBe(true);

      const result2 = analyzer.removePerformancePattern('non-existent');
      expect(result2).toBe(false);
    });
  });
});