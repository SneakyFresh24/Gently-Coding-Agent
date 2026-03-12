/**
 * TypeScript Type Checker
 * 
 * Provides type checking for TypeScript and JavaScript files using the
 * TypeScript Compiler API.
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { ValidationResult, ValidationError, ValidationCacheEntry } from './types';

/**
 * TypeScript Type Checker
 */
export class TypeChecker {
  private cache: Map<string, ValidationCacheEntry> = new Map();
  private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check TypeScript/JavaScript code for type errors
   */
  async checkTypes(
    code: string,
    language: string,
    filePath?: string
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    // Only check TypeScript/JavaScript
    if (!this.isTypeCheckableLanguage(language)) {
      return {
        valid: true,
        errors: [],
        warnings: [{
          message: `Type checking not available for ${language}`,
          code: 'UNSUPPORTED_LANGUAGE',
          source: 'TypeChecker'
        }],
        metadata: {
          validator: 'TypeChecker',
          language,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }

    // Check cache
    const cacheKey = this.getCacheKey(code, language);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[TypeChecker] Cache hit for ${language}`);
      return {
        ...cached,
        metadata: {
          ...cached.metadata!,
          cacheHit: true
        }
      };
    }

    try {
      let result: ValidationResult;

      // Python type checking with Pyright
      if (language === 'python') {
        result = await this.checkPythonTypes(code, filePath);
      } else {
        // TypeScript/JavaScript type checking
        const tempFilePath = filePath || this.createTempFilePath(language);

        // Get TypeScript compiler options
        const compilerOptions = this.getCompilerOptions(language);

        // Create in-memory host
        const host = this.createCompilerHost(code, tempFilePath, compilerOptions);

        // Create program
        const program = ts.createProgram([tempFilePath], compilerOptions, host);

        // Get diagnostics
        const diagnostics = [
          ...program.getSyntacticDiagnostics(),
          ...program.getSemanticDiagnostics(),
          ...program.getDeclarationDiagnostics()
        ];

        // Convert diagnostics to validation errors
        const errors = this.convertDiagnosticsToErrors(diagnostics, code);

        result = {
          valid: errors.length === 0,
          errors,
          metadata: {
            validator: 'TypeChecker',
            language,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
            cacheHit: false
          }
        };
      }

      // Cache result
      this.addToCache(cacheKey, result, code);

      console.log(`[TypeChecker] Type checking complete for ${language}: ${result.errors.length} errors`);
      return result;

    } catch (error) {
      console.error(`[TypeChecker] Type checking error:`, error);
      return {
        valid: false,
        errors: [{
          type: 'type',
          message: `Type checking failed: ${error}`,
          severity: 'error',
          source: 'TypeChecker'
        }],
        metadata: {
          validator: 'TypeChecker',
          language,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Create in-memory compiler host
   */
  private createCompilerHost(
    code: string,
    fileName: string,
    options: ts.CompilerOptions
  ): ts.CompilerHost {
    const host = ts.createCompilerHost(options);

    // Override file reading to use in-memory code
    const originalGetSourceFile = host.getSourceFile;
    host.getSourceFile = (
      sourceFileName: string,
      languageVersion: ts.ScriptTarget,
      onError?: (message: string) => void
    ) => {
      if (sourceFileName === fileName) {
        return ts.createSourceFile(sourceFileName, code, languageVersion, true);
      }
      // Fall back to default for other files (e.g., lib.d.ts)
      return originalGetSourceFile(sourceFileName, languageVersion, onError);
    };

    // Override file existence check
    const originalFileExists = host.fileExists;
    host.fileExists = (sourceFileName: string) => {
      if (sourceFileName === fileName) {
        return true;
      }
      return originalFileExists(sourceFileName);
    };

    return host;
  }

  /**
   * Get TypeScript compiler options
   */
  private getCompilerOptions(language: string): ts.CompilerOptions {
    // Try to load tsconfig.json from workspace
    const tsconfigPath = path.join(this.workspaceRoot, 'tsconfig.json');
    
    let compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      lib: ['lib.es2020.d.ts'],
      strict: false, // Don't be too strict for validation
      noEmit: true,
      skipLibCheck: true,
      skipDefaultLibCheck: true,
      allowJs: language === 'javascript',
      checkJs: language === 'javascript',
      jsx: language === 'tsx' || language === 'jsx' ? ts.JsxEmit.React : undefined,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
    };

    // Try to load from tsconfig.json
    if (fs.existsSync(tsconfigPath)) {
      try {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (!configFile.error) {
          const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            this.workspaceRoot
          );
          compilerOptions = {
            ...compilerOptions,
            ...parsedConfig.options,
            noEmit: true, // Always override
            skipLibCheck: true,
            skipDefaultLibCheck: true
          };
        }
      } catch (error) {
        console.warn('[TypeChecker] Failed to load tsconfig.json:', error);
      }
    }

    return compilerOptions;
  }

  /**
   * Convert TypeScript diagnostics to validation errors
   */
  private convertDiagnosticsToErrors(
    diagnostics: readonly ts.Diagnostic[],
    code: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    for (const diagnostic of diagnostics) {
      // Skip lib.d.ts errors
      if (diagnostic.file?.fileName.includes('lib.') || 
          diagnostic.file?.fileName.includes('node_modules')) {
        continue;
      }

      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      
      let line: number | undefined;
      let column: number | undefined;
      let endLine: number | undefined;
      let endColumn: number | undefined;

      if (diagnostic.file && diagnostic.start !== undefined) {
        const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        line = start.line + 1; // 1-based
        column = start.character + 1;

        if (diagnostic.length !== undefined) {
          const end = diagnostic.file.getLineAndCharacterOfPosition(
            diagnostic.start + diagnostic.length
          );
          endLine = end.line + 1;
          endColumn = end.character + 1;
        }
      }

      // Get code context
      let suggestion: string | undefined;
      if (line && line <= lines.length) {
        const errorLine = lines[line - 1];
        const contextStart = Math.max(0, (column || 0) - 20);
        const contextEnd = Math.min(errorLine.length, (column || 0) + 20);
        suggestion = `Near: "${errorLine.substring(contextStart, contextEnd)}"`;
      }

      errors.push({
        type: 'type',
        message,
        line,
        column,
        endLine,
        endColumn,
        severity: diagnostic.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
        code: `TS${diagnostic.code}`,
        source: diagnostic.file?.fileName || 'unknown',
        suggestion
      });
    }

    return errors;
  }

  /**
   * Check Python types with Pyright
   */
  private async checkPythonTypes(code: string, filePath?: string): Promise<ValidationResult> {
    const startTime = Date.now();

    try {
      // Check if pyright is installed
      const pyrightInstalled = await this.checkCommandExists('pyright');

      if (!pyrightInstalled) {
        return {
          valid: true,
          errors: [],
          warnings: [{
            message: 'Pyright not installed. Install with: npm install -g pyright',
            code: 'PYRIGHT_NOT_FOUND',
            source: 'TypeChecker'
          }],
          metadata: {
            validator: 'TypeChecker',
            language: 'python',
            duration: Date.now() - startTime,
            timestamp: Date.now()
          }
        };
      }

      // Create temporary file
      const tempFilePath = filePath || path.join(this.workspaceRoot, '.gently-temp.py');
      fs.writeFileSync(tempFilePath, code, 'utf8');

      try {
        // Run pyright
        const output = await this.runCommand('pyright', ['--outputjson', tempFilePath]);

        // Parse pyright output
        const errors = this.parsePyrightOutput(output, code);

        return {
          valid: errors.length === 0,
          errors,
          metadata: {
            validator: 'TypeChecker',
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
      console.error('[TypeChecker] Python type checking error:', error);
      return {
        valid: false,
        errors: [{
          type: 'type',
          message: `Python type checking failed: ${error}`,
          severity: 'error',
          source: 'TypeChecker'
        }],
        metadata: {
          validator: 'TypeChecker',
          language: 'python',
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Parse Pyright JSON output
   */
  private parsePyrightOutput(output: string, code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    try {
      const result = JSON.parse(output);

      if (result.generalDiagnostics) {
        for (const diagnostic of result.generalDiagnostics) {
          errors.push({
            type: 'type',
            message: diagnostic.message,
            line: diagnostic.range?.start?.line ? diagnostic.range.start.line + 1 : undefined,
            column: diagnostic.range?.start?.character ? diagnostic.range.start.character + 1 : undefined,
            endLine: diagnostic.range?.end?.line ? diagnostic.range.end.line + 1 : undefined,
            endColumn: diagnostic.range?.end?.character ? diagnostic.range.end.character + 1 : undefined,
            severity: diagnostic.severity === 'error' ? 'error' : 'warning',
            code: diagnostic.rule,
            source: 'Pyright'
          });
        }
      }
    } catch (parseError) {
      console.warn('[TypeChecker] Failed to parse Pyright output:', parseError);
    }

    return errors;
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
        if (code === 0 || stdout) {
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
   * Check if language supports type checking
   */
  private isTypeCheckableLanguage(language: string): boolean {
    const normalized = language.toLowerCase();
    return ['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'python'].includes(normalized);
  }

  /**
   * Create temporary file path
   */
  private createTempFilePath(language: string): string {
    const ext = this.getFileExtension(language);
    return path.join(this.workspaceRoot, `.gently-temp${ext}`);
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
        return '.ts';
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
    console.log('[TypeChecker] Cache cleared');
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

