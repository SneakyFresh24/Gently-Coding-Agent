/**
 * Architectural Drift Analyzer – Starke Version 2026
 * Nutzt Memory-Bank + RelationshipGraph für echte Architektur-Checks
 */

import { BaseAnalyzer } from './BaseAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianSeverity, GuardianSource, GuardianAnalysisContext, SuggestionType, SuggestionAction, EffortLevel } from '../types';
import { MemoryManager } from '../../agent/memory/MemoryManager';
import { RelationshipGraph } from '../../agent/graph/RelationshipGraph';
import * as path from 'path';
import * as fs from 'fs';

export class ArchitecturalDriftAnalyzer extends BaseAnalyzer {
  constructor(
    private memoryManager: MemoryManager,
    private relationshipGraph: RelationshipGraph
  ) {
    super('architectural-drift', 'Architectural Drift Analyzer', 'Erkennt Verstöße gegen gespeicherte Architektur-Regeln');
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      console.log('[ArchitecturalDriftAnalyzer] Starting intelligent analysis...');

      // 1. Memory-Bank Regeln prüfen (das ist der große Gewinn!)
      const memories = await this.memoryManager.getRelevantMemories('architecture pattern rule decision layer test-first naming', 15);

      for (const mem of memories) {
        const violations = await this.checkAgainstMemoryRule(mem.memory.content, context);
        issues.push(...violations);
      }

      // 2. Graph-basierte Layering-Checks
      const layeringIssues = await this.checkLayeringWithGraph(context);
      issues.push(...layeringIssues);

      // 3. Test-First & Naming (schnell & effektiv)
      const testFirst = await this.checkTestFirstPattern(context);
      issues.push(...testFirst);

      const namingIssues = await this.checkNamingConventions(context);
      issues.push(...namingIssues);

      console.log(`[ArchitecturalDriftAnalyzer] Found ${issues.length} real architectural issues`);
    } catch (error) {
      console.error('[ArchitecturalDriftAnalyzer] Error:', error);
    }

    return issues;
  }

  private async checkAgainstMemoryRule(rule: string, context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];
    const files = context.changedFiles.length > 0 ? context.changedFiles : [];

    if (rule.toLowerCase().includes('test-first') || rule.toLowerCase().includes('tests first')) {
      for (const file of files) {
        if (this.isSourceFile(file) && !this.hasTestFile(file)) {
          issues.push(this.createIssue(
            GuardianIssueType.ARCHITECTURAL_DRIFT,
            GuardianSeverity.MEDIUM,
            'Test-First Regel verletzt',
            `Memory-Bank verlangt Test-First. Keine Test-Datei für ${path.basename(file)} gefunden.`,
            file,
            undefined,
            GuardianSource.MEMORY_SYSTEM
          ));
        }
      }
    }

    // Weitere Regeln aus Memory können hier leicht erweitert werden
    return issues;
  }

  private async checkLayeringWithGraph(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];
    const files = context.changedFiles.length > 0 ? context.changedFiles : [];

    for (const filePath of files) {
      const imports = this.relationshipGraph.getImportedSymbols(filePath as any);

      for (const imp of imports) {
        const sourceLayer = this.getLayerFromPath(filePath);
        const targetFile = this.getResolvedPath(imp);
        const targetLayer = this.getLayerFromPath(targetFile);

        if (sourceLayer === 'ui' && targetLayer === 'data') {
          issues.push(this.createIssue(
            GuardianIssueType.ARCHITECTURAL_DRIFT,
            GuardianSeverity.HIGH,
            'Layering Violation (UI → Data)',
            `UI-Komponente importiert direkt aus Data-Layer: ${imp.relationship.symbol}`,
            filePath,
            undefined,
            GuardianSource.RELATIONSHIP_GRAPH
          ));
        }
      }
    }
    return issues;
  }

  private getLayerFromPath(filePath: string): string {
    if (filePath.includes('/components/') || filePath.includes('/ui/')) return 'ui';
    if (filePath.includes('/services/') || filePath.includes('/api/')) return 'service';
    if (filePath.includes('/database/') || filePath.includes('/data/')) return 'data';
    return 'other';
  }

  private async checkNamingConventions(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];
    try {
      const filesToCheck = context.changedFiles.length > 0
        ? context.changedFiles
        : await this.getSourceFiles(context);

      for (const filePath of filesToCheck) {
        const basename = path.basename(filePath);
        if (filePath.endsWith('.tsx') && basename[0] !== basename[0].toUpperCase()) {
          issues.push(this.createIssue(
            GuardianIssueType.ARCHITECTURAL_DRIFT,
            GuardianSeverity.MEDIUM,
            'Naming Convention Violation',
            'React components (.tsx) should use PascalCase for their filenames.',
            filePath
          ));
        }
      }
    } catch (error) {
      console.error('[ArchitecturalDriftAnalyzer] Error checking naming conventions:', error);
    }
    return issues;
  }

  private async checkTestFirstPattern(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      const filesToCheck = context.changedFiles.length > 0
        ? context.changedFiles
        : await this.getSourceFiles(context);

      for (const filePath of filesToCheck) {
        if (this.isSourceFile(filePath) && !this.hasTestFile(filePath)) {
          const issue = this.createIssue(
            GuardianIssueType.ARCHITECTURAL_DRIFT,
            GuardianSeverity.MEDIUM,
            'Missing test file',
            `According to stored patterns, tests should be written first. No test file found for ${path.basename(filePath)}.`,
            filePath,
            undefined,
            GuardianSource.MEMORY_SYSTEM
          );

          issue.suggestions.push({
            id: this.generateId(),
            type: SuggestionType.ADD_TEST,
            title: 'Create test file',
            description: `Create a test file for ${path.basename(filePath)}`,
            action: SuggestionAction.FIX_IT,
            confidence: 0.7,
            estimatedEffort: EffortLevel.MEDIUM
          });

          issues.push(issue);
        }
      }
    } catch (error) {
      console.error('[ArchitecturalDriftAnalyzer] Error checking test-first pattern:', error);
    }

    return issues;
  }

  private async getSourceFiles(context?: GuardianAnalysisContext): Promise<string[]> {
    return context?.changedFiles || [];
  }

  private isSourceFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.ts', '.js', '.tsx', '.jsx', '.py'].includes(ext);
  }

  private hasTestFile(filePath: string): boolean {
    const dir = path.dirname(filePath);
    const name = path.basename(filePath, path.extname(filePath));
    const testPatterns = [
      path.join(dir, `${name}.test.ts`),
      path.join(dir, `${name}.spec.ts`),
      path.join(dir, `test`, `${name}.test.ts`),
      path.join(dir, `tests`, `${name}.test.ts`)
    ];

    try {
      return testPatterns.some(testPath => fs.existsSync(testPath));
    } catch {
      return false;
    }
  }

  private createIssue(
    type: GuardianIssueType,
    severity: GuardianSeverity,
    title: string,
    description: string,
    filePath: string,
    lineNumbers?: number[],
    source: GuardianSource = GuardianSource.MEMORY_SYSTEM,
    memoryId?: string
  ): GuardianIssue {
    return {
      id: this.generateId(),
      type,
      severity,
      title,
      description,
      filePath,
      lineNumbers,
      suggestions: [],
      metadata: {
        source,
        memoryId
      },
      createdAt: Date.now()
    };
  }

  private generateId(): string {
    return `arch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Kleine Hilfsmethode: ResolvedPath aus RelationshipGraph korrekt holen
   */
  private getResolvedPath(imp: any): string {
    return imp.relationship?.resolvedPath ||
      imp.relationship?.targetFile ||
      imp.targetFile || '';
  }
}