/**
 * Guardian Service - Proactive Code Health Engine
 * 
 * This service coordinates background analysis and provides
 * proactive code health suggestions to improve the codebase.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import {
  GuardianIssue,
  GuardianConfig,
  GuardianStats,
  GuardianAnalysisContext,
  GuardianAnalysisResult,
  GuardianSeverity,
  GuardianIssueType,
  getSeverityWeight
} from './types';
import { RelationshipGraph } from '../agent/graph/RelationshipGraph';
import { MemoryManager } from '../agent/memory/MemoryManager';
import { ValidationManager } from '../agent/validation/ValidationManager';
import { HybridRetriever } from '../agent/retrieval/HybridRetriever';
import { CodebaseIndexer } from '../agent/CodebaseIndexer';
import { AnalyzerManager } from './AnalyzerManager';

/**
 * Default Guardian configuration
 */
const DEFAULT_CONFIG: GuardianConfig = {
  enabled: true,
  autoAnalysis: true,
  analysisInterval: 5 * 60 * 1000, // 5 minutes
  maxIssuesPerFile: 10,
  severityThreshold: GuardianSeverity.MEDIUM,
  enabledIssueTypes: [
    GuardianIssueType.CODE_DUPLICATION,
    GuardianIssueType.DEAD_CODE,
    GuardianIssueType.ARCHITECTURAL_DRIFT,
    GuardianIssueType.SECURITY_PATTERN,
    GuardianIssueType.PERFORMANCE_ISSUE
  ],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**'
  ],
  includePatterns: [
    '**/*.ts',
    '**/*.js',
    '**/*.tsx',
    '**/*.jsx',
    '**/*.py'
  ]
};

export class GuardianService extends EventEmitter {
  private config: GuardianConfig;
  private analyzerManager: AnalyzerManager;
  private workspaceRoot: string;
  private issues: Map<string, GuardianIssue> = new Map();
  private analysisTimer?: NodeJS.Timeout;
  private isAnalyzing: boolean = false;
  private lastAnalysisTime: number = 0;
  private stats: GuardianStats;
  private fileWatcher?: vscode.FileSystemWatcher;

  private memoryManager: MemoryManager;
  private validationManager: ValidationManager;
  private hybridRetriever: HybridRetriever;
  private codebaseIndexer: CodebaseIndexer;

  constructor(
    workspaceRoot: string,
    relationshipGraph: RelationshipGraph,
    memoryManager: MemoryManager,
    validationManager: ValidationManager,
    hybridRetriever: HybridRetriever,
    codebaseIndexer: CodebaseIndexer,
    config?: Partial<GuardianConfig>
  ) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.analyzerManager = new AnalyzerManager(relationshipGraph, memoryManager);
    this.stats = this.initializeStats();

    // Store references to components for later use
    this.memoryManager = memoryManager;
    this.validationManager = validationManager;
    this.hybridRetriever = hybridRetriever;
    this.codebaseIndexer = codebaseIndexer;

    // Listen to analyzer events
    this.setupAnalyzerEventListeners();

    this.log('info', 'Initialized with workspace:', workspaceRoot);
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]) {
    const prefix = '[GuardianService]';
    switch (level) {
      case 'info':
        console.log(`${prefix} ${message}`, ...args);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`, ...args);
        break;
      case 'error':
        console.error(`${prefix} ${message}`, ...args);
        break;
    }
  }

  /**
   * Initialize the Guardian service
   */
  async initialize(): Promise<void> {
    console.log('[GuardianService] Initializing...');

    // Initialize components
    if (this.memoryManager) {
      await this.memoryManager.initialize();
    }

    if (this.validationManager) {
      await this.validationManager.initialize();
    }

    if (this.hybridRetriever) {
      // HybridRetriever doesn't have an initialize method, but has initializeHNSW
      try {
        await this.hybridRetriever.initializeHNSW();
      } catch (error) {
        console.warn('[GuardianService] Failed to initialize HNSW:', error);
        // Continue without HNSW - it's optional
      }
    }

    if (this.codebaseIndexer) {
      // CodebaseIndexer doesn't have an initialize method, but we can ensure it's ready
      console.log('[GuardianService] CodebaseIndexer is ready');
    }

    // Start auto-analysis if enabled
    if (this.config.autoAnalysis) {
      this.startAutoAnalysis();
    }

    // Register file change listeners
    this.registerFileChangeListeners();

    console.log('[GuardianService] Initialization complete');
  }

  /**
   * Setup analyzer event listeners
   */
  private setupAnalyzerEventListeners(): void {
    this.analyzerManager.on('analysisComplete', (data) => {
      this.log('info', 'Emitting analysisComplete event', {
        issues: data.issues?.length,
        duration: data.duration
      });
      this.emit('analysisComplete', data);
    });

    this.analyzerManager.on('analyzerComplete', (data) => {
      console.log(`[GuardianService] Analyzer ${data.analyzer} completed with ${data.issues.length} issues`);
    });

    this.analyzerManager.on('analyzerError', (data) => {
      console.error(`[GuardianService] Analyzer ${data.analyzer} failed:`, data.error);
    });
  }

  /**
   * Start automatic analysis at configured intervals
   */
  startAutoAnalysis(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
    }

    this.analysisTimer = setInterval(() => {
      if (!this.isAnalyzing) {
        this.performAnalysis([]);
      }
    }, this.config.analysisInterval);

    this.log('info', `Auto-analysis started with interval: ${this.config.analysisInterval}ms`);
  }

  /**
   * Stop automatic analysis
   */
  stopAutoAnalysis(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = undefined;
    }

    console.log('[GuardianService] Auto-analysis stopped');
  }

  /**
   * Filter files to only those that should be analyzed
   */
  private getFilesToAnalyze(context: GuardianAnalysisContext): string[] {
    if (context.changedFiles && context.changedFiles.length > 0) {
      return context.changedFiles.filter(f => this.shouldAnalyzeFile(f));
    }
    // Voll-Scan nur bei Bedarf (z. B. manuell oder alle 30 Min.)
    return [];
  }

  /**
   * Helper to recursively look up all files for a full scan
   */
  private async getAllSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    const collectRelevantFiles = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && !['node_modules', 'dist', 'build', 'out'].includes(entry.name)) {
            collectRelevantFiles(fullPath);
          } else if (/\.(ts|js|tsx|jsx)$/.test(fullPath)) {
            files.push(fullPath);
          }
        }
      } catch (e) {
        console.warn(`[GuardianService] Could not read dir ${dir}`);
      }
    };
    collectRelevantFiles(this.workspaceRoot);
    return files;
  }

  /**
   * Perform analysis on specific files or full workspace
   */
  async performAnalysis(changedFiles: string[] = [], fullAnalysis: boolean = false): Promise<GuardianAnalysisResult> {
    if (this.isAnalyzing) {
      this.log('info', 'Analysis already in progress, skipping');
      return this.createEmptyResult(changedFiles, fullAnalysis);
    }

    this.isAnalyzing = true;
    const startTime = Date.now();

    try {
      this.log('info', `Starting ${fullAnalysis ? 'full' : 'incremental'} analysis`, { changedFiles: changedFiles.length });

      const filesToScan = fullAnalysis
        ? await this.getAllSourceFiles()
        : (changedFiles.length > 0 ? changedFiles : []);

      const fileCache = new Map<string, string>();

      const context: GuardianAnalysisContext = {
        workspaceRoot: this.workspaceRoot,
        changedFiles: filesToScan,
        fullAnalysis,
        timestamp: startTime,
        getFileContent: (filePath: string) => {
          if (!fileCache.has(filePath)) {
            try {
              fileCache.set(filePath, fs.readFileSync(filePath, 'utf-8'));
            } catch (e) {
              fileCache.set(filePath, '');
              console.warn(`[GuardianService] Error reading file for cache: ${filePath}`);
            }
          }
          return fileCache.get(filePath)!;
        }
      };

      // Run analysis through analyzer manager
      const newIssues = await this.analyzerManager.runAnalysis(context, this.config);

      // Update issues map
      this.updateIssues(newIssues);

      // Update stats
      this.updateStats();

      const duration = Date.now() - startTime;
      this.lastAnalysisTime = startTime;

      const result: GuardianAnalysisResult = {
        issues: Array.from(this.issues.values()),
        stats: this.stats,
        context,
        duration
      };

      this.log('info', `Analysis complete in ${duration}ms`, { issueCount: newIssues.length, stats: this.stats });

      // Emit analysisComplete event for UI updates
      this.emit('analysisComplete', result);

      return result;
    } catch (error) {
      this.log('error', 'Analysis failed:', error);
      throw error;
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Update issues map with new issues
   */
  private updateIssues(newIssues: GuardianIssue[]): void {
    // Clear old issues for changed files
    const changedFilePaths = new Set(newIssues.map(issue => issue.filePath));

    for (const [id, issue] of this.issues) {
      if (changedFilePaths.has(issue.filePath)) {
        this.issues.delete(id);
      }
    }

    // Add new issues
    for (const issue of newIssues) {
      this.issues.set(issue.id, issue);
    }

    // Limit issues per file
    this.limitIssuesPerFile();
  }

  /**
   * Limit number of issues per file
   */
  private limitIssuesPerFile(): void {
    const issuesByFile = new Map<string, GuardianIssue[]>();

    // Group issues by file
    for (const issue of this.issues.values()) {
      if (!issuesByFile.has(issue.filePath)) {
        issuesByFile.set(issue.filePath, []);
      }
      issuesByFile.get(issue.filePath)!.push(issue);
    }

    // Sort by severity and limit
    for (const [filePath, fileIssues] of issuesByFile) {
      fileIssues.sort((a, b) => getSeverityWeight(b.severity) - getSeverityWeight(a.severity));

      if (fileIssues.length > this.config.maxIssuesPerFile) {
        const toRemove = fileIssues.slice(this.config.maxIssuesPerFile);
        for (const issue of toRemove) {
          this.issues.delete(issue.id);
        }
      }
    }
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const issues = Array.from(this.issues.values());

    this.stats.totalIssues = issues.length;
    this.stats.lastAnalysisTime = this.lastAnalysisTime;

    // Reset counters
    this.stats.issuesByType = {
      code_duplication: 0,
      dead_code: 0,
      architectural_drift: 0,
      security_pattern: 0,
      performance_issue: 0,
      maintainability: 0,
      test_coverage: 0
    };

    this.stats.issuesBySeverity = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    // Count by type and severity
    for (const issue of issues) {
      this.stats.issuesByType[issue.type]++;
      this.stats.issuesBySeverity[issue.severity]++;
    }
  }

  /**
   * Initialize statistics
   */
  private initializeStats(): GuardianStats {
    return {
      totalIssues: 0,
      issuesByType: {
        code_duplication: 0,
        dead_code: 0,
        architectural_drift: 0,
        security_pattern: 0,
        performance_issue: 0,
        maintainability: 0,
        test_coverage: 0
      },
      issuesBySeverity: {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0
      },
      dismissedIssues: 0,
      fixedIssues: 0,
      lastAnalysisTime: 0,
      analysisDuration: 0
    };
  }

  /**
   * Register file change listeners
   */
  private registerFileChangeListeners(): void {
    // Listen for file changes
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
    }
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceRoot, '**/*')
    );

    this.fileWatcher.onDidChange(async (uri) => {
      if (this.shouldAnalyzeFile(uri.fsPath)) {
        await this.performAnalysis([uri.fsPath]);
      }
    });

    this.fileWatcher.onDidCreate(async (uri) => {
      if (this.shouldAnalyzeFile(uri.fsPath)) {
        await this.performAnalysis([uri.fsPath]);
      }
    });

    console.log('[GuardianService] File change listeners registered');
  }

  /**
   * Check if file should be analyzed
   */
  private shouldAnalyzeFile(filePath: string): boolean {
    const relativePath = path.relative(this.workspaceRoot, filePath);

    // Check exclude patterns
    for (const pattern of this.config.excludePatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return false;
      }
    }

    // Check include patterns
    for (const pattern of this.config.includePatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if path matches glob pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    if (pattern.startsWith('**/')) {
      const ext = pattern.replace('**/', '');
      return normalizedPath.includes(ext.replace('/**', '')) || normalizedPath.endsWith(ext.replace('*.', '.'));
    }

    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');

    return new RegExp(`^.*?${regexPattern}.*$`).test(normalizedPath);
  }

  /**
   * Create empty analysis result
   */
  private createEmptyResult(changedFiles: string[], fullAnalysis: boolean): GuardianAnalysisResult {
    return {
      issues: Array.from(this.issues.values()),
      stats: this.stats,
      context: {
        workspaceRoot: this.workspaceRoot,
        changedFiles,
        fullAnalysis,
        timestamp: Date.now()
      },
      duration: 0
    };
  }

  /**
   * Get all current issues
   */
  getIssues(): GuardianIssue[] {
    return Array.from(this.issues.values());
  }

  /**
   * Get issues for a specific file
   */
  getIssuesForFile(filePath: string): GuardianIssue[] {
    return Array.from(this.issues.values()).filter(issue => issue.filePath === filePath);
  }

  /**
   * Dismiss an issue
   */
  dismissIssue(issueId: string): boolean {
    const issue = this.issues.get(issueId);
    if (issue) {
      issue.dismissedAt = Date.now();
      this.issues.delete(issueId);
      this.stats.dismissedIssues++;
      this.emit('issueDismissed', issue);
      return true;
    }
    return false;
  }

  /**
   * Get statistics
   */
  getStats(): GuardianStats {
    return { ...this.stats };
  }

  /**
   * Get analyzer manager
   */
  getAnalyzerManager(): AnalyzerManager {
    return this.analyzerManager;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GuardianConfig>): void {
    this.config = { ...this.config, ...config };

    // Update analyzer manager configuration
    this.analyzerManager.updateConfig(this.config);

    // Restart auto-analysis if interval changed
    if (config.analysisInterval && this.config.autoAnalysis) {
      this.startAutoAnalysis();
    }

    console.log('[GuardianService] Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): GuardianConfig {
    return { ...this.config };
  }

  /**
   * Prüft einen Befehl vor der Ausführung (Security-Check für run_command)
   */
  async beforeRunCommand(command: string): Promise<{ allow: boolean; reason?: string }> {
    const cmd = command.trim().toLowerCase();

    // Destruktive Befehle
    if (cmd.includes('rm -rf') || cmd.includes('sudo rm')) {
      return {
        allow: false,
        reason: '🛑 Destruktiver Befehl erkannt. rm -rf oder sudo rm sind aus Sicherheitsgründen gesperrt.'
      };
    }

    // Performance / Best Practice: Keine globalen Installs
    if (cmd.includes('npm install -g') || cmd.includes('yarn global') || cmd.includes('pnpm add -g')) {
      return {
        allow: false,
        reason: '⚠️ Globale Installationen sind deaktiviert. Bitte verwende lokale Abhängigkeiten.'
      };
    }

    // Weitere Checks können hier ergänzt werden
    return { allow: true };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopAutoAnalysis();
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = undefined;
    }
    this.analyzerManager.dispose();
    this.removeAllListeners();
    this.issues.clear();
    console.log('[GuardianService] Disposed');
  }
}