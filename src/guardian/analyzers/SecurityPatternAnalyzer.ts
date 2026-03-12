/**
 * Security Pattern Analyzer
 * 
 * Detects security vulnerabilities and anti-patterns in code
 */

import * as fs from 'fs';
import { BaseAnalyzer } from './BaseAnalyzer';
import { GuardianIssue, GuardianIssueType, GuardianSeverity, GuardianSource, GuardianAnalysisContext, SuggestionType, SuggestionAction, EffortLevel } from '../types';

export class SecurityPatternAnalyzer extends BaseAnalyzer {
  private securityPatterns: SecurityPattern[] = [
    {
      name: 'eval_usage',
      pattern: /\beval\s*\(/i,
      severity: GuardianSeverity.HIGH,
      title: 'Use of eval() function',
      description: 'The eval() function can execute arbitrary code and poses a security risk.',
      recommendation: 'Avoid using eval(). Consider using safer alternatives like JSON.parse() for JSON data.'
    },
    {
      name: 'new_function_usage',
      pattern: /\bnew\s+Function\s*\(/i,
      severity: GuardianSeverity.HIGH,
      title: 'Use of new Function()',
      description: 'new Function() can execute arbitrary code and poses a security risk.',
      recommendation: 'Use safer alternatives like JSON.parse() or avoid dynamic code execution.'
    },
    {
      name: 'inner_html',
      pattern: /innerHTML\s*=/,
      severity: GuardianSeverity.MEDIUM,
      title: 'Direct innerHTML assignment',
      description: 'Direct innerHTML assignment can lead to XSS vulnerabilities if the content is not sanitized.',
      recommendation: 'Use textContent or sanitize the HTML before assignment.'
    },
    {
      name: 'hardcoded_password',
      pattern: /password\s*=\s*['"][^'"]+['"]/,
      severity: GuardianSeverity.CRITICAL,
      title: 'Hardcoded password',
      description: 'Hardcoded passwords in source code are a security risk.',
      recommendation: 'Use environment variables or secure configuration management.'
    },
    {
      name: 'hardcoded_api_key',
      pattern: /api[_-]?key\s*=\s*['"][^'"]+['"]/,
      severity: GuardianSeverity.HIGH,
      title: 'Hardcoded API key',
      description: 'Hardcoded API keys in source code can be exposed.',
      recommendation: 'Use environment variables or secure key management.'
    },
    {
      name: 'sql_injection',
      pattern: /(execute|query)\s*\(\s*['"`][^'"`]*\+[^'"`]*['"`]/,
      severity: GuardianSeverity.CRITICAL,
      title: 'Potential SQL injection',
      description: 'String concatenation in SQL queries can lead to SQL injection vulnerabilities.',
      recommendation: 'Use parameterized queries or prepared statements.'
    },
    {
      name: 'regex_dos',
      pattern: /\/.*\(\.\*\*\).*\/[gimuy]*/,
      severity: GuardianSeverity.MEDIUM,
      title: 'Potential ReDoS vulnerability',
      description: 'Complex regular expressions with nested quantifiers can cause denial of service.',
      recommendation: 'Avoid nested quantifiers or use timeout mechanisms.'
    },
    {
      name: 'path_traversal',
      pattern: /(readFile|writeFile|open)\s*\(\s*.*\+.*\s*\)/,
      severity: GuardianSeverity.HIGH,
      title: 'Potential path traversal',
      description: 'File operations with concatenated paths can lead to path traversal vulnerabilities.',
      recommendation: 'Validate and sanitize file paths, use path.resolve() carefully.'
    }
  ];

  constructor() {
    super(
      'security-patterns',
      'Security Pattern Analyzer',
      'Detects security vulnerabilities and anti-patterns in code'
    );
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      console.log('[SecurityPatternAnalyzer] Starting analysis...');

      const filesToCheck = context.changedFiles.length > 0
        ? context.changedFiles
        : await this.getSourceFiles(context);

      for (const filePath of filesToCheck) {
        const fileIssues = await this.analyzeFile(filePath, context);
        issues.push(...fileIssues);
      }

      console.log(`[SecurityPatternAnalyzer] Found ${issues.length} security issues`);
    } catch (error) {
      console.error('[SecurityPatternAnalyzer] Analysis failed:', error);
    }

    return issues;
  }

  /**
   * Analyze a specific file for security patterns
   */
  private async analyzeFile(filePath: string, context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    const issues: GuardianIssue[] = [];

    try {
      const content = context.getFileContent ? context.getFileContent(filePath) : await this.readFileContent(filePath);

      for (const securityPattern of this.securityPatterns) {
        const matches = content.match(securityPattern.pattern);
        if (matches) {
          // Zusätzliche Filter gegen False Positives
          if (securityPattern.name === 'hardcoded_password' && content.includes('process.env')) {
            continue;
          }

          const lineNumbers = this.findLineNumbers(content, securityPattern.pattern);

          const issue = this.createIssue(
            GuardianIssueType.SECURITY_PATTERN,
            securityPattern.severity,
            securityPattern.title,
            securityPattern.description,
            filePath,
            lineNumbers,
            GuardianSource.VALIDATION_PIPELINE
          );

          // Add recommendation as a suggestion
          issue.suggestions.push({
            id: this.generateId(),
            type: SuggestionType.SECURITY_FIX,
            title: 'Fix security issue',
            description: securityPattern.recommendation,
            action: SuggestionAction.SHOW_ME,
            confidence: 0.9,
            estimatedEffort: this.getEffortForPattern(securityPattern)
          });

          issues.push(issue);
        }
      }
    } catch (error) {
      console.error(`[SecurityPatternAnalyzer] Error analyzing ${filePath}:`, error);
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
   * Get effort level for fixing a security pattern
   */
  private getEffortForPattern(pattern: SecurityPattern): EffortLevel {
    switch (pattern.name) {
      case 'hardcoded_password':
      case 'hardcoded_api_key':
        return EffortLevel.LOW;
      case 'eval_usage':
      case 'inner_html':
        return EffortLevel.MEDIUM;
      case 'sql_injection':
      case 'path_traversal':
        return EffortLevel.HIGH;
      default:
        return EffortLevel.MEDIUM;
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
      console.error(`[SecurityPatternAnalyzer] Error reading file ${filePath}:`, error);
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
    return `sec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Add custom security pattern
   */
  addSecurityPattern(pattern: SecurityPattern): void {
    this.securityPatterns.push(pattern);
  }

  /**
   * Remove security pattern by name
   */
  removeSecurityPattern(name: string): boolean {
    const index = this.securityPatterns.findIndex(p => p.name === name);
    if (index >= 0) {
      this.securityPatterns.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all security patterns
   */
  getSecurityPatterns(): SecurityPattern[] {
    return [...this.securityPatterns];
  }
}

interface SecurityPattern {
  name: string;
  pattern: RegExp;
  severity: GuardianSeverity;
  title: string;
  description: string;
  recommendation: string;
}