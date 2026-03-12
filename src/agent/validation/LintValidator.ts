/**
 * Lint Validator
 * 
 * Provides linting for TypeScript/JavaScript using ESLint
 * and Python using Pylint/Ruff.
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { ValidationResult, ValidationError, ValidationWarning, ValidationCacheEntry } from './types';

// Dynamic import for ESLint (only load when needed)
let ESLintClass: any = null;

/**
 * Lint Validator
 */
export class LintValidator {
  private cache: Map<string, ValidationCacheEntry> = new Map();
  private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes
  private workspaceRoot: string;
  private eslintInstance: any = null;
  private eslintConfigPath?: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Initialize ESLint
   */
  async initialize(): Promise<void> {
    try {
      // Dynamically import ESLint
      if (!ESLintClass) {
        // @ts-ignore - ESLint types not available
        const eslintModule = await import('eslint');
        ESLintClass = eslintModule.ESLint;
      }

      // Find ESLint config
      this.eslintConfigPath = this.findESLintConfig();

      console.log('[LintValidator] Initialized', {
        configPath: this.eslintConfigPath || 'default'
      });
    } catch (error) {
      console.warn('[LintValidator] Failed to initialize ESLint:', error);
    }
  }

  /**
   * Lint code
   */
  async lint(
    code: string,
    language: string,
    filePath?: string,
    autoFix: boolean = false
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    // Only lint supported languages
    if (!this.isLintableLanguage(language)) {
      return {
        valid: true,
        errors: [],
        warnings: [{
          message: `Linting not available for ${language}`,
          code: 'UNSUPPORTED_LANGUAGE',
          source: 'LintValidator'
        }],
        metadata: {
          validator: 'LintValidator',
          language,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }

    // Check cache (only if not auto-fixing)
    if (!autoFix) {
      const cacheKey = this.getCacheKey(code, language);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        console.log(`[LintValidator] Cache hit for ${language}`);
        return {
          ...cached,
          metadata: {
            ...cached.metadata!,
            cacheHit: true
          }
        };
      }
    }

    try {
      let result: ValidationResult;

      if (this.isJavaScriptLike(language)) {
        result = await this.lintWithESLint(code, language, filePath, autoFix);
      } else if (language === 'python') {
        result = await this.lintPython(code, filePath);
      } else {
        result = {
          valid: true,
          errors: [],
          warnings: [{
            message: `No linter configured for ${language}`,
            source: 'LintValidator'
          }],
          metadata: {
            validator: 'LintValidator',
            language,
            duration: Date.now() - startTime,
            timestamp: Date.now()
          }
        };
      }

      // Cache result (only if not auto-fixing)
      if (!autoFix) {
        const cacheKey = this.getCacheKey(code, language);
        this.addToCache(cacheKey, result, code);
      }

      console.log(`[LintValidator] Linting complete for ${language}: ${result.errors.length} errors, ${result.warnings?.length || 0} warnings`);
      return result;

    } catch (error) {
      console.error(`[LintValidator] Linting error:`, error);
      return {
        valid: false,
        errors: [{
          type: 'lint',
          message: `Linting failed: ${error}`,
          severity: 'error',
          source: 'LintValidator'
        }],
        metadata: {
          validator: 'LintValidator',
          language,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Lint with ESLint
   */
  private async lintWithESLint(
    code: string,
    language: string,
    filePath?: string,
    autoFix: boolean = false
  ): Promise<ValidationResult> {
    if (!ESLintClass) {
      throw new Error('ESLint not initialized');
    }

    try {
      // Create ESLint instance
      const eslint = new ESLintClass({
        cwd: this.workspaceRoot,
        useEslintrc: true,
        fix: autoFix,
        overrideConfigFile: this.eslintConfigPath,
        overrideConfig: this.getDefaultESLintConfig(language)
      });

      // Determine file path for linting
      const lintFilePath = filePath || this.createTempFilePath(language);

      // Lint code
      const results = await eslint.lintText(code, {
        filePath: lintFilePath
      });

      // Extract errors and warnings
      const errors: ValidationError[] = [];
      const warnings: ValidationWarning[] = [];

      for (const result of results) {
        for (const message of result.messages) {
          const error: ValidationError = {
            type: 'lint',
            message: message.message,
            line: message.line,
            column: message.column,
            endLine: message.endLine,
            endColumn: message.endColumn,
            severity: message.severity === 2 ? 'error' : 'warning',
            code: message.ruleId || undefined,
            source: 'ESLint',
            suggestion: message.fix ? 'Auto-fix available' : undefined
          };

          if (message.severity === 2) {
            errors.push(error);
          } else {
            warnings.push({
              message: error.message,
              line: error.line,
              column: error.column,
              code: error.code,
              source: error.source
            });
          }
        }
      }

      // Get fixed code if auto-fix was enabled
      let fixedCode: string | undefined;
      if (autoFix && results[0]?.output) {
        fixedCode = results[0].output;
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fixedCode,
        metadata: {
          validator: 'LintValidator',
          language,
          duration: Date.now() - Date.now(),
          timestamp: Date.now()
        }
      };

    } catch (error) {
      throw new Error(`ESLint error: ${error}`);
    }
  }

  /**
   * Lint Python code with Ruff
   */
  private async lintPython(code: string, filePath?: string): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Check if ruff is installed
      const ruffInstalled = await this.checkCommandExists('ruff');

      if (!ruffInstalled) {
        return {
          valid: true,
          errors: [],
          warnings: [{
            message: 'Ruff not installed. Install with: pip install ruff',
            code: 'RUFF_NOT_FOUND',
            source: 'LintValidator'
          }],
          metadata: {
            validator: 'LintValidator',
            language: 'python',
            duration: Date.now() - startTime,
            timestamp: Date.now()
          }
        };
      }

      // Create temporary file
      const tempFilePath = filePath || path.join(this.workspaceRoot, '.gently-lint-temp.py');
      fs.writeFileSync(tempFilePath, code, 'utf8');

      try {
        // Run ruff with JSON output
        const output = await this.runCommand('ruff', ['check', '--output-format=json', tempFilePath]);

        // Parse ruff output
        const { errors, warnings } = this.parseRuffOutput(output, code);

        return {
          valid: errors.length === 0,
          errors,
          warnings,
          metadata: {
            validator: 'LintValidator',
            language: 'python',
            duration: Date.now() - startTime,
            timestamp: Date.now()
          }
        };

      } finally {
        // Clean up temp file
        if (!filePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }

    } catch (error) {
      console.error('[LintValidator] Python linting error:', error);
      return {
        valid: false,
        errors: [{
          type: 'lint',
          message: `Python linting failed: ${error}`,
          severity: 'error',
          source: 'LintValidator'
        }],
        metadata: {
          validator: 'LintValidator',
          language: 'python',
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Parse Ruff JSON output
   */
  private parseRuffOutput(output: string, code: string): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    try {
      const diagnostics = JSON.parse(output);

      for (const diagnostic of diagnostics) {
        const error: ValidationError = {
          type: 'lint',
          message: diagnostic.message,
          line: diagnostic.location?.row,
          column: diagnostic.location?.column,
          endLine: diagnostic.end_location?.row,
          endColumn: diagnostic.end_location?.column,
          severity: diagnostic.severity === 'error' ? 'error' : 'warning',
          code: diagnostic.code,
          source: 'Ruff',
          suggestion: diagnostic.fix ? 'Auto-fix available' : undefined
        };

        if (diagnostic.severity === 'error') {
          errors.push(error);
        } else {
          warnings.push({
            message: error.message,
            line: error.line,
            column: error.column,
            code: error.code,
            source: error.source
          });
        }
      }
    } catch (parseError) {
      console.warn('[LintValidator] Failed to parse Ruff output:', parseError);
    }

    return { errors, warnings };
  }

  /**
   * Check if command exists
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    try {
      await this.runCommand(command, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run command and return output
   */
  private runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(command, args, {
        cwd: this.workspaceRoot,
        shell: true
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        // Ruff returns exit code 1 when it finds issues, but that's not an error
        if (code === 0 || code === 1 || stdout) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Command failed with code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get default ESLint configuration
   */
  private getDefaultESLintConfig(language: string): any {
    const config: any = {
      env: {
        browser: true,
        es2021: true,
        node: true
      },
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module'
      },
      rules: {
        // Only enable critical rules by default
        'no-undef': 'error',
        'no-unused-vars': 'warn',
        'no-unreachable': 'warn'
      }
    };

    // TypeScript-specific config
    if (language === 'typescript' || language === 'tsx') {
      config.parser = '@typescript-eslint/parser';
      config.parserOptions.project = this.findTSConfig();
      config.plugins = ['@typescript-eslint'];
    }

    // React/JSX config
    if (language === 'tsx' || language === 'jsx') {
      config.parserOptions.ecmaFeatures = { jsx: true };
      config.plugins = config.plugins || [];
      if (!config.plugins.includes('react')) {
        config.plugins.push('react');
      }
    }

    return config;
  }

  /**
   * Find ESLint config file
   */
  private findESLintConfig(): string | undefined {
    const configFiles = [
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
      'eslint.config.js'
    ];

    for (const configFile of configFiles) {
      const configPath = path.join(this.workspaceRoot, configFile);
      if (fs.existsSync(configPath)) {
        console.log(`[LintValidator] Found ESLint config: ${configFile}`);
        return configPath;
      }
    }

    return undefined;
  }

  /**
   * Find tsconfig.json
   */
  private findTSConfig(): string | undefined {
    const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
    if (fs.existsSync(tsconfigPath)) {
      return tsconfigPath;
    }
    return undefined;
  }

  /**
   * Check if language is lintable
   */
  private isLintableLanguage(language: string): boolean {
    const normalized = language.toLowerCase();
    return ['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'python'].includes(normalized);
  }

  /**
   * Check if language is JavaScript-like
   */
  private isJavaScriptLike(language: string): boolean {
    const normalized = language.toLowerCase();
    return ['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js'].includes(normalized);
  }

  /**
   * Create temporary file path
   */
  private createTempFilePath(language: string): string {
    const ext = this.getFileExtension(language);
    return path.join(this.workspaceRoot, `.gently-lint-temp${ext}`);
  }

  /**
   * Get file extension for language
   */
  private getFileExtension(language: string): string {
    const normalized = language.toLowerCase();
    switch (normalized) {
      case 'typescript':
      case 'ts':
        return '.ts';
      case 'tsx':
        return '.tsx';
      case 'javascript':
      case 'js':
        return '.js';
      case 'jsx':
        return '.jsx';
      case 'python':
        return '.py';
      default:
        return '.txt';
    }
  }

  /**
   * Generate cache key
   */
  private getCacheKey(code: string, language: string): string {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(`${language}:${code}`);
    return hash.digest('hex');
  }

  /**
   * Get result from cache
   */
  private getFromCache(key: string): ValidationResult | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * Add result to cache
   */
  private addToCache(key: string, result: ValidationResult, code: string): void {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    
    this.cache.set(key, {
      result,
      contentHash: hash,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.cacheMaxAge
    });

    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[LintValidator] Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxAge: number } {
    return {
      size: this.cache.size,
      maxAge: this.cacheMaxAge
    };
  }
}

