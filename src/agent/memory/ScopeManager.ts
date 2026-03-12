/**
 * Scope Manager for Context-Aware Memory Retrieval
 * 
 * Handles matching of memory scopes with current context.
 */

import { MemoryScope, MemoryContext, ScopeMatchResult } from './types';
import * as path from 'path';
import { minimatch } from 'minimatch';

const MAX_SCOPE_ARRAY_SIZE = 20;

export class ScopeManager {
  /**
   * Check if a memory scope matches the current context
   */
  matchesContext(scope: MemoryScope | undefined, context: MemoryContext): ScopeMatchResult {
    // No scope = global memory, always matches
    if (!scope) {
      return {
        matches: true,
        score: 1.0,
        reason: 'Global memory (no scope restrictions)'
      };
    }

    let totalScore = 0;
    let matchCount = 0;
    let totalChecks = 0;
    const reasons: string[] = [];

    // Check language
    if (scope.language && scope.language.length > 0) {
      totalChecks++;
      if (context.language && scope.language.includes(context.language)) {
        matchCount++;
        totalScore += 1.0;
        reasons.push(`Language match: ${context.language}`);
      } else {
        reasons.push(`Language mismatch: expected ${scope.language.join('|')}, got ${context.language || 'none'}`);
      }
    }

    // Check file extension
    if (scope.fileExtension && scope.fileExtension.length > 0) {
      totalChecks++;
      if (context.fileExtension && scope.fileExtension.includes(context.fileExtension)) {
        matchCount++;
        totalScore += 1.0;
        reasons.push(`Extension match: ${context.fileExtension}`);
      } else {
        reasons.push(`Extension mismatch: expected ${scope.fileExtension.join('|')}, got ${context.fileExtension || 'none'}`);
      }
    }

    // Check path pattern
    if (scope.pathPattern && scope.pathPattern.length > 0) {
      totalChecks++;
      if (context.filePath) {
        const pathMatch = this.matchesPathPattern(context.filePath, scope.pathPattern);
        if (pathMatch) {
          matchCount++;
          totalScore += 1.0;
          reasons.push(`Path match: ${context.filePath}`);
        } else {
          reasons.push(`Path mismatch: ${context.filePath} doesn't match ${scope.pathPattern.join('|')}`);
        }
      } else {
        reasons.push(`Path mismatch: no file path provided`);
      }
    }

    // Check exclude pattern
    if (scope.excludePattern && scope.excludePattern.length > 0) {
      if (context.filePath) {
        const excluded = this.matchesPathPattern(context.filePath, scope.excludePattern);
        if (excluded) {
          return {
            matches: false,
            score: 0,
            reason: `Excluded by pattern: ${context.filePath}`
          };
        }
      }
    }

    // Check file type
    if (scope.fileType && scope.fileType.length > 0) {
      totalChecks++;
      if (context.fileType && scope.fileType.includes(context.fileType)) {
        matchCount++;
        totalScore += 1.0;
        reasons.push(`File type match: ${context.fileType}`);
      } else {
        reasons.push(`File type mismatch: expected ${scope.fileType.join('|')}, got ${context.fileType || 'none'}`);
      }
    }

    // Calculate final score
    const finalScore = totalChecks > 0 ? totalScore / totalChecks : 1.0;
    const matches = matchCount === totalChecks; // All checks must pass

    return {
      matches,
      score: finalScore,
      reason: reasons.join('; ')
    };
  }

  /**
   * Match file path against patterns (supports wildcards)
   */
  private matchesPathPattern(filePath: string, patterns: string[]): boolean {
    const normalizedPath = this.normalizePath(filePath);

    for (const pattern of patterns) {
      const normalizedPattern = this.normalizePath(pattern);

      if (this.matchGlob(normalizedPath, normalizedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Simple glob matching (supports minimatch)
   */
  private matchGlob(str: string, pattern: string): boolean {
    return minimatch(str, pattern, { dot: true, nocase: true });
  }

  /**
   * Normalize path (convert backslashes to forward slashes)
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
  }

  /**
   * Detect language from file extension
   */
  detectLanguage(fileExtension: string): string | undefined {
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.go': 'go',
      '.rs': 'rust',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.m': 'objective-c',
      '.sh': 'bash',
      '.ps1': 'powershell',
      '.sql': 'sql',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.txt': 'text'
    };

    return languageMap[fileExtension.toLowerCase()];
  }

  /**
   * Detect file type from path
   */
  detectFileType(filePath: string): string | undefined {
    const normalizedPath = this.normalizePath(filePath).toLowerCase();

    // Test files
    if (normalizedPath.includes('/test/') ||
      normalizedPath.includes('/tests/') ||
      normalizedPath.includes('.test.') ||
      normalizedPath.includes('.spec.')) {
      return 'test';
    }

    // Component files
    if (normalizedPath.includes('/component') ||
      normalizedPath.match(/[A-Z][a-z]+\.(tsx|jsx)$/)) {
      return 'component';
    }

    // Config files
    if (normalizedPath.includes('config') ||
      normalizedPath.match(/\.(config|rc)\./)) {
      return 'config';
    }

    // Utility files
    if (normalizedPath.includes('/util') ||
      normalizedPath.includes('/helper')) {
      return 'utility';
    }

    // Service files
    if (normalizedPath.includes('/service') ||
      normalizedPath.includes('/api/')) {
      return 'service';
    }

    // Model files
    if (normalizedPath.includes('/model') ||
      normalizedPath.includes('/entity')) {
      return 'model';
    }

    // Controller files
    if (normalizedPath.includes('/controller')) {
      return 'controller';
    }

    // View files
    if (normalizedPath.includes('/view') ||
      normalizedPath.includes('/page')) {
      return 'view';
    }

    return undefined;
  }

  /**
   * Create context from file path
   */
  createContext(filePath: string): MemoryContext {
    const ext = path.extname(filePath);
    const language = this.detectLanguage(ext);
    const fileType = this.detectFileType(filePath);

    return {
      language,
      fileExtension: ext,
      filePath,
      fileType
    };
  }

  /**
   * Validate scope
   */
  validateScope(scope: MemoryScope): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if at least one scope field is defined
    if (!scope.language && !scope.fileExtension && !scope.pathPattern && !scope.fileType) {
      errors.push('Scope must have at least one restriction (language, fileExtension, pathPattern, or fileType)');
    }

    // Validate array sizes
    const arrayFields: (keyof MemoryScope)[] = ['language', 'fileExtension', 'pathPattern', 'excludePattern', 'fileType'];
    for (const field of arrayFields) {
      const value = scope[field];
      if (Array.isArray(value) && value.length > MAX_SCOPE_ARRAY_SIZE) {
        errors.push(`${field} array too large (max ${MAX_SCOPE_ARRAY_SIZE} items, got ${value.length})`);
      }
    }

    // Validate language values
    if (scope.language) {
      const validLanguages = [
        'typescript', 'javascript', 'python', 'java', 'cpp', 'c', 'csharp',
        'go', 'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala'
      ];
      const invalid = scope.language.filter(l => !validLanguages.includes(l));
      if (invalid.length > 0) {
        errors.push(`Invalid languages: ${invalid.join(', ')}`);
      }
    }

    // Validate file extensions (must start with .)
    if (scope.fileExtension) {
      const invalid = scope.fileExtension.filter(e => !e.startsWith('.'));
      if (invalid.length > 0) {
        errors.push(`File extensions must start with '.': ${invalid.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

