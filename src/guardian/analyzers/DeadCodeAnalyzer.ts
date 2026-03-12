/**
 * Dead Code Analyzer
 * 
 * Detects unused functions, classes, variables, and imports
 */

import { BaseAnalyzer } from './BaseAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianSeverity, GuardianSource, GuardianAnalysisContext, SuggestionType, SuggestionAction, EffortLevel } from '../types';
import { RelationshipGraph } from '../../agent/graph/RelationshipGraph';
import { SymbolDefinition, ImportRelationship } from '../../agent/graph/types';

export class DeadCodeAnalyzer extends BaseAnalyzer {
  constructor(private relationshipGraph: RelationshipGraph) {
    super(
      'dead-code',
      'Dead Code Analyzer',
      'Detects unused functions, classes, variables, and imports'
    );
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      console.log('[DeadCodeAnalyzer] Starting analysis...');

      // Check for unused symbols
      const unusedSymbols = await this.findUnusedSymbols(context);

      for (const symbol of unusedSymbols) {
        const issue = this.createIssue(
          GuardianIssueType.DEAD_CODE,
          GuardianSeverity.LOW,
          `Unused ${symbol.kind}: ${symbol.name}`,
          `The ${symbol.kind} '${symbol.name}' is defined but never called or imported.`,
          symbol.file,
          [symbol.line || 0],
          GuardianSource.RELATIONSHIP_GRAPH
        );

        // Add suggestions
        issue.suggestions.push({
          id: this.generateId(),
          type: SuggestionType.REMOVE_UNUSED,
          title: 'Remove unused code',
          description: `Remove the unused ${symbol.kind} '${symbol.name}'`,
          action: SuggestionAction.FIX_IT,
          confidence: 0.9,
          estimatedEffort: EffortLevel.TRIVIAL
        });

        issues.push(issue);
      }

      // Check for unused imports
      const unusedImports = await this.findUnusedImports(context);

      for (const importInfo of unusedImports) {
        const issue = this.createIssue(
          GuardianIssueType.DEAD_CODE,
          GuardianSeverity.LOW,
          `Unused import: ${importInfo.symbol || importInfo.source}`,
          `The imported symbol '${importInfo.symbol || importInfo.source}' is not used in the file.`,
          importInfo.importer,
          [importInfo.line || 0],
          GuardianSource.RELATIONSHIP_GRAPH
        );

        issue.suggestions.push({
          id: this.generateId(),
          type: SuggestionType.UPDATE_IMPORT,
          title: 'Remove unused import',
          description: `Remove the unused import '${importInfo.symbol || importInfo.source}'`,
          action: SuggestionAction.FIX_IT,
          confidence: 0.9,
          estimatedEffort: EffortLevel.TRIVIAL
        });

        issues.push(issue);
      }

      console.log(`[DeadCodeAnalyzer] Found ${issues.length} dead code issues`);
    } catch (error) {
      console.error('[DeadCodeAnalyzer] Analysis failed:', error);
    }

    return issues;
  }

  /**
   * Find unused symbols in the codebase
   */
  private async findUnusedSymbols(context: GuardianAnalysisContext): Promise<SymbolDefinition[]> {
    const unusedSymbols: SymbolDefinition[] = [];

    try {
      // Get all symbols from the relationship graph
      const allSymbols = this.getAllSymbols(context);

      for (const symbol of allSymbols) {
        if (symbol.kind === 'function' || symbol.kind === 'class' || symbol.kind === 'variable') {
          // Check if symbol is referenced
          const callers = this.relationshipGraph.getDirectCallers(symbol.name, symbol.file);

          if (callers.length === 0) {
            // Potential dead code
            unusedSymbols.push(symbol);
          }
        }
      }
    } catch (error) {
      console.error('[DeadCodeAnalyzer] Error finding unused symbols:', error);
    }

    return unusedSymbols;
  }

  /**
   * Find unused imports in files
   */
  private async findUnusedImports(context: GuardianAnalysisContext): Promise<ImportRelationship[]> {
    const unusedImports: ImportRelationship[] = [];

    try {
      // This analyzes import statements and checks if imported symbols are used via RelationshipGraph and file content
      const files = this.getFilesToAnalyze(context);

      for (const filePath of files) {
        const imports = await this.getImportsForFile(filePath);

        for (const importInfo of imports) {
          const isUsed = await this.isImportUsed(importInfo, filePath, context);

          if (!isUsed) {
            unusedImports.push(importInfo);
          }
        }
      }
    } catch (error) {
      console.error('[DeadCodeAnalyzer] Error finding unused imports:', error);
    }

    return unusedImports;
  }

  /**
   * Get all symbols from the relationship graph
   */
  private getAllSymbols(context: GuardianAnalysisContext): SymbolDefinition[] {
    const symbols: SymbolDefinition[] = [];
    for (const filePath of context.changedFiles) {
      symbols.push(...this.relationshipGraph.getSymbolsInFile(filePath as any));
    }
    return symbols;
  }

  /**
   * Get files to analyze
   */
  private getFilesToAnalyze(context: GuardianAnalysisContext): string[] {
    return context.changedFiles;
  }

  /**
   * Get imports for a specific file
   */
  private async getImportsForFile(filePath: string): Promise<ImportRelationship[]> {
    return this.relationshipGraph.getImportedSymbols(filePath as any).map(res => res.relationship);
  }

  /**
   * Check if an import is used in a file
   */
  private async isImportUsed(importInfo: ImportRelationship, filePath: string, context: GuardianAnalysisContext): Promise<boolean> {
    if (context.getFileContent) {
      const content = context.getFileContent(filePath);
      // Rough AST-less check: does the symbol name appear more than once (once in import, once in usage)?
      if (importInfo.symbol && importInfo.symbol !== '*') {
        const matches = content.match(new RegExp(`\\b${importInfo.symbol}\\b`, 'g'));
        return matches !== null && matches.length > 1;
      }
    }
    return true; // Fallback to avoid false positives
  }

  /**
   * Create a new Guardian issue
   */
  private createIssue(
    type: GuardianIssueType,
    severity: GuardianSeverity,
    title: string,
    description: string,
    filePath: string,
    lineNumbers?: number[],
    source: GuardianSource = GuardianSource.RELATIONSHIP_GRAPH
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
        source
      },
      createdAt: Date.now()
    };
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `dead-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}