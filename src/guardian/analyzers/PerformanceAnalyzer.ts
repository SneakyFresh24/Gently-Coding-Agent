/**
 * Performance Analyzer
 * 
 * Detects performance issues and anti-patterns in code
 */

import * as fs from 'fs';
import { BaseAnalyzer } from './BaseAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianSeverity, GuardianSource, GuardianAnalysisContext, SuggestionType, SuggestionAction, EffortLevel } from '../types';

export class PerformanceAnalyzer extends BaseAnalyzer {
  private performancePatterns: PerformancePattern[] = [
    {
      name: 'for_in_loop',
      pattern: /\bfor\s*\(\s*(?:const|let|var)?\s*\w+\s+in\s+/,
      severity: GuardianSeverity.MEDIUM,
      title: 'for...in loop on arrays',
      description: 'Using for...in loop on arrays can be inefficient and may iterate over prototype properties.',
      recommendation: 'Use for...of, Array.forEach(), or traditional for loop with index for arrays.'
    },
    {
      name: 'dom_queries_in_loop',
      pattern: /for\s*\(.*\)\s*\{[^}]*document\.(getElementById|querySelector|querySelectorAll)/,
      severity: GuardianSeverity.HIGH,
      title: 'DOM queries inside loops',
      description: 'DOM queries inside loops can cause significant performance degradation.',
      recommendation: 'Cache DOM queries outside the loop or use event delegation.'
    },
    {
      name: 'inefficient_length_check',
      pattern: /\.length\s*>\s*0/,
      severity: GuardianSeverity.LOW,
      title: 'Inefficient length check',
      description: 'Using .length > 0 can be slightly less efficient than checking truthiness.',
      recommendation: 'Use array.length or Boolean(array) instead.'
    },
    {
      name: 'synchronous_file_operations',
      pattern: /\b(readFileSync|writeFileSync|existsSync|mkdirSync|appendFileSync)\b/,
      severity: GuardianSeverity.HIGH,
      title: 'Synchronous file operations',
      description: 'Synchronous file operations block the event loop and can cause performance issues.',
      recommendation: 'Use asynchronous file operations (readFile, writeFile, etc.) instead.'
    },
    {
      name: 'memory_leak_pattern',
      pattern: /setInterval\s*\([^,]+,\s*\d+\)/,
      severity: GuardianSeverity.MEDIUM,
      title: 'Potential memory leak - setInterval',
      description: 'setInterval without proper cleanup can cause memory leaks.',
      recommendation: 'Ensure clearInterval is called when the component is unmounted or no longer needed.'
    },
    {
      name: 'inefficient_string_concatenation',
      pattern: /(\+\s*['"`]|['"`]\s*\+)/,
      severity: GuardianSeverity.LOW,
      title: 'Inefficient string concatenation in loops',
      description: 'String concatenation in loops can be inefficient due to immutable strings.',
      recommendation: 'Use array.join() or template literals for better performance.'
    },
    {
      name: 'blocking_operations',
      pattern: /(while\s*\([^)]*\)\s*\{|for\s*\([^)]*\)\s*\{)[^}]*\bsleep\b\s*\(/,
      severity: GuardianSeverity.HIGH,
      title: 'Blocking operations detected',
      description: 'Blocking operations like sleep() in loops can freeze the application.',
      recommendation: 'Use asynchronous alternatives or break up the work into chunks.'
    }
  ];

  constructor() {
    super(
      'performance',
      'Performance Analyzer',
      'Detects performance issues and anti-patterns in code'
    );
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      console.log('[PerformanceAnalyzer] Starting analysis...');

      const filesToCheck = context.changedFiles.length > 0
        ? context.changedFiles
        : await this.getSourceFiles(context);

      for (const filePath of filesToCheck) {
        const fileIssues = await this.analyzeFile(filePath, context);
        issues.push(...fileIssues);
      }

      console.log(`[PerformanceAnalyzer] Found ${issues.length} performance issues`);
    } catch (error) {
      console.error('[PerformanceAnalyzer] Analysis failed:', error);
    }

    return issues;
  }

  /**
   * Analyze a specific file for performance patterns
   */
  private async analyzeFile(filePath: string, context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      const content = context.getFileContent ? context.getFileContent(filePath) : await this.readFileContent(filePath);

      for (const performancePattern of this.performancePatterns) {
        const matches = content.match(performancePattern.pattern);
        if (matches) {
          // Zusätzliche False-Positive-Filter
          if (performancePattern.name === 'dom_queries_in_loop' && (content.includes('.forEach') || content.includes('map('))) {
            continue; // oft falsch positiv bei modernem Code
          }

          const lineNumbers = this.findLineNumbers(content, performancePattern.pattern);

          const issue = this.createIssue(
            GuardianIssueType.PERFORMANCE_ISSUE,
            performancePattern.severity,
            performancePattern.title,
            performancePattern.description,
            filePath,
            lineNumbers,
            GuardianSource.VALIDATION_PIPELINE
          );

          // Add recommendation as a suggestion
          issue.suggestions.push({
            id: this.generateId(),
            type: SuggestionType.PERFORMANCE_OPTIMIZATION,
            title: 'Optimize performance',
            description: performancePattern.recommendation,
            action: SuggestionAction.SHOW_ME,
            confidence: 0.8,
            estimatedEffort: this.getEffortForPattern(performancePattern)
          });

          issues.push(issue);
        }
      }
    } catch (error) {
      console.error(`[PerformanceAnalyzer] Error analyzing ${filePath}:`, error);
    }

    return issues;
  }

  /**
   * Find line numbers where pattern matches
   */
  private findLineNumbers(content: string, pattern: RegExp): number[] {
    const lines = content.split('\n');
    const lineNumbers: number[] = [];

    lines.forEach((line, index) => {
      // Use string.search to evaluate without risking RegExp.lastIndex mutation across global flags
      if (line.search(pattern) !== -1) {
        lineNumbers.push(index + 1);
      }
    });

    return lineNumbers;
  }

  /**
   * Get effort level for fixing a performance pattern
   */
  private getEffortForPattern(pattern: PerformancePattern): EffortLevel {
    switch (pattern.name) {
      case 'inefficient_length_check':
      case 'inefficient_string_concatenation':
        return EffortLevel.TRIVIAL;
      case 'for_in_loop':
      case 'synchronous_file_operations':
      case 'memory_leak_pattern':
        return EffortLevel.LOW;
      case 'dom_queries_in_loop':
      case 'blocking_operations':
        return EffortLevel.MEDIUM;
      default:
        return EffortLevel.LOW;
    }
  }

  /**
   * Get source files to analyze
   */
  private async getSourceFiles(context?: GuardianAnalysisContext): Promise<string[]> {
    return context?.changedFiles || [];
  }

  /**
   * Read file content
   */
  private async readFileContent(filePath: string): Promise<string> {
    try {
      return await fs.promises.readFile(filePath, 'utf-8');
    } catch (error) {
      console.error(`[PerformanceAnalyzer] Error reading file ${filePath}:`, error);
      return '';
    }
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
    source: GuardianSource = GuardianSource.VALIDATION_PIPELINE
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
    return `perf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Add custom performance pattern
   */
  addPerformancePattern(pattern: PerformancePattern): void {
    this.performancePatterns.push(pattern);
  }

  /**
   * Remove performance pattern by name
   */
  removePerformancePattern(name: string): boolean {
    const index = this.performancePatterns.findIndex(p => p.name === name);
    if (index >= 0) {
      this.performancePatterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all performance patterns
   */
  getPerformancePatterns(): PerformancePattern[] {
    return [...this.performancePatterns];
  }
}

interface PerformancePattern {
  name: string;
  pattern: RegExp;
  severity: GuardianSeverity;
  title: string;
  description: string;
  recommendation: string;
}