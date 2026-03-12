/**
 * Analyzer Manager
 * 
 * Coordinates all analyzers and manages their execution
 */

import { EventEmitter } from 'events';
import { IAnalyzer } from './analyzers/BaseAnalyzer';
import { CodeDuplicationAnalyzer } from './analyzers/CodeDuplicationAnalyzer';
import { DeadCodeAnalyzer } from './analyzers/DeadCodeAnalyzer';
import { ArchitecturalDriftAnalyzer } from './analyzers/ArchitecturalDriftAnalyzer';
import { SecurityPatternAnalyzer } from './analyzers/SecurityPatternAnalyzer';
import { PerformanceAnalyzer } from './analyzers/PerformanceAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianAnalysisContext, GuardianConfig, getSeverityWeight } from './types';
import { RelationshipGraph } from '../agent/graph/RelationshipGraph';
import { MemoryManager } from '../agent/memory/MemoryManager';

export class AnalyzerManager extends EventEmitter {
  private analyzers: Map<string, IAnalyzer> = new Map();
  private enabledAnalyzers: Set<string> = new Set();

  constructor(
    private relationshipGraph: RelationshipGraph,
    private memoryManager: MemoryManager
  ) {
    super();
    this.initializeAnalyzers();
  }

  /**
   * Initialize all analyzers
   */
  private initializeAnalyzers(): void {
    // Register all built-in analyzers
    this.registerAnalyzer(new CodeDuplicationAnalyzer(this.relationshipGraph));
    this.registerAnalyzer(new DeadCodeAnalyzer(this.relationshipGraph));
    this.registerAnalyzer(new ArchitecturalDriftAnalyzer(this.memoryManager, this.relationshipGraph));
    this.registerAnalyzer(new SecurityPatternAnalyzer());
    this.registerAnalyzer(new PerformanceAnalyzer());

    // Enable all analyzers by default
    for (const [id] of this.analyzers) {
      this.enabledAnalyzers.add(id);
    }

    this.log('info', `Initialized ${this.analyzers.size} analyzers`);
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]) {
    console[level === 'error' ? 'error' : level](`[AnalyzerManager] ${message}`, ...args);
  }

  /**
   * Register a new analyzer
   */
  registerAnalyzer(analyzer: IAnalyzer): void {
    this.analyzers.set(analyzer.id, analyzer);
    console.log(`[AnalyzerManager] Registered analyzer: ${analyzer.id}`);
  }

  /**
   * Unregister an analyzer
   */
  unregisterAnalyzer(analyzerId: string): boolean {
    const removed = this.analyzers.delete(analyzerId);
    this.enabledAnalyzers.delete(analyzerId);

    if (removed) {
      console.log(`[AnalyzerManager] Unregistered analyzer: ${analyzerId}`);
    }

    return removed;
  }

  /**
   * Get an analyzer by ID
   */
  getAnalyzer(analyzerId: string): IAnalyzer | undefined {
    return this.analyzers.get(analyzerId);
  }

  /**
   * Get all registered analyzers
   */
  getAllAnalyzers(): IAnalyzer[] {
    return Array.from(this.analyzers.values());
  }

  /**
   * Get all enabled analyzers
   */
  getEnabledAnalyzers(): IAnalyzer[] {
    return Array.from(this.analyzers.values())
      .filter(analyzer => this.enabledAnalyzers.has(analyzer.id) && analyzer.isEnabled());
  }

  /**
   * Enable an analyzer
   */
  enableAnalyzer(analyzerId: string): boolean {
    const analyzer = this.analyzers.get(analyzerId);
    if (analyzer) {
      analyzer.setEnabled(true);
      this.enabledAnalyzers.add(analyzerId);
      console.log(`[AnalyzerManager] Enabled analyzer: ${analyzerId}`);
      return true;
    }
    return false;
  }

  /**
   * Disable an analyzer
   */
  disableAnalyzer(analyzerId: string): boolean {
    const analyzer = this.analyzers.get(analyzerId);
    if (analyzer) {
      analyzer.setEnabled(false);
      this.enabledAnalyzers.delete(analyzerId);
      console.log(`[AnalyzerManager] Disabled analyzer: ${analyzerId}`);
      return true;
    }
    return false;
  }

  /**
   * Run analysis with all enabled analyzers
   */
  async runAnalysis(context: GuardianAnalysisContext, config?: GuardianConfig): Promise<GuardianIssue[]> {
    const enabledAnalyzers = this.getEnabledAnalyzers();

    // Filter analyzers based on config if provided
    const analyzersToRun = config
      ? enabledAnalyzers.filter(analyzer => this.shouldRunAnalyzer(analyzer, config))
      : enabledAnalyzers;

    this.log('info', `Running analysis with ${analyzersToRun.length} estimators`);

    const allIssues: GuardianIssue[] = [];
    const analysisPromises: Promise<void>[] = [];

    // Run all analyzers in parallel
    for (const analyzer of analyzersToRun) {
      const promise = this.runAnalyzer(analyzer, context, allIssues);
      analysisPromises.push(promise);
    }

    // Wait for all analyzers to complete
    await Promise.all(analysisPromises);

    // Sort issues by severity
    allIssues.sort((a, b) => getSeverityWeight(b.severity) - getSeverityWeight(a.severity));

    this.log('info', `Analysis complete`, {
      totalIssues: allIssues.length
    });

    // Emit event for analysis completion
    this.emit('analysisComplete', {
      issues: allIssues,
      context,
      analyzers: analyzersToRun.map(a => a.id)
    });

    return allIssues;
  }

  /**
   * Run a single analyzer
   */
  private async runAnalyzer(
    analyzer: IAnalyzer,
    context: GuardianAnalysisContext,
    issues: GuardianIssue[]
  ): Promise<void> {
    try {
      const startTime = Date.now();
      const analyzerIssues = await analyzer.analyze(context);
      const duration = Date.now() - startTime;

      issues.push(...analyzerIssues);

      this.log('info', `Analyzer ${analyzer.name} completed`, {
        issuesFound: analyzerIssues.length,
        durationMs: duration
      });

      // Emit event for individual analyzer completion
      this.emit('analyzerComplete', {
        analyzer: analyzer.id,
        issues: analyzerIssues,
        duration
      });
    } catch (error) {
      this.log('error', `Error in analyzer ${analyzer.id}:`, error);

      // Emit event for analyzer error
      this.emit('analyzerError', {
        analyzer: analyzer.id,
        error
      });
    }
  }

  /**
   * Check if analyzer should run based on config
   */
  private shouldRunAnalyzer(analyzer: IAnalyzer, config: GuardianConfig): boolean {
    // Map analyzer IDs to issue types
    const analyzerToIssueType: Record<string, GuardianIssueType> = {
      'code-duplication': GuardianIssueType.CODE_DUPLICATION,
      'dead-code': GuardianIssueType.DEAD_CODE,
      'architectural-drift': GuardianIssueType.ARCHITECTURAL_DRIFT,
      'security-patterns': GuardianIssueType.SECURITY_PATTERN,
      'performance': GuardianIssueType.PERFORMANCE_ISSUE
    };

    const issueType = analyzerToIssueType[analyzer.id];
    return issueType ? config.enabledIssueTypes.includes(issueType) : true;
  }

  /**
   * Update analyzer configuration
   */
  updateConfig(config: GuardianConfig): void {
    // Enable/disable analyzers based on config
    for (const [analyzerId, analyzer] of this.analyzers) {
      const shouldRun = this.shouldRunAnalyzer(analyzer, config);

      if (shouldRun && !analyzer.isEnabled()) {
        this.enableAnalyzer(analyzerId);
      } else if (!shouldRun && analyzer.isEnabled()) {
        this.disableAnalyzer(analyzerId);
      }
    }

    console.log('[AnalyzerManager] Configuration updated');
  }

  /**
   * Get analyzer statistics
   */
  getStats(): AnalyzerStats {
    const analyzers = Array.from(this.analyzers.values());

    return {
      totalAnalyzers: analyzers.length,
      enabledAnalyzers: analyzers.filter(a => a.isEnabled()).length,
      disabledAnalyzers: analyzers.filter(a => !a.isEnabled()).length,
      analyzerDetails: analyzers.map(a => ({
        id: a.id,
        name: a.name,
        description: a.description,
        enabled: a.isEnabled()
      }))
    };
  }

  /**
   * Dispose of all analyzers
   */
  dispose(): void {
    this.removeAllListeners();
    this.analyzers.clear();
    this.enabledAnalyzers.clear();
    console.log('[AnalyzerManager] Disposed');
  }
}

interface AnalyzerStats {
  totalAnalyzers: number;
  enabledAnalyzers: number;
  disabledAnalyzers: number;
  analyzerDetails: Array<{
    id: string;
    name: string;
    description: string;
    enabled: boolean;
  }>;
}