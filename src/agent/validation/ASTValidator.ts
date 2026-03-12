/**
 * AST-based Syntax Validator using Tree-sitter
 *
 * Provides syntax validation for multiple languages using Tree-sitter parsers.
 * Detects syntax errors with precise line/column information.
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { ValidationResult, ValidationError, ValidationCacheEntry } from './types';

// Import web-tree-sitter (WebAssembly-based, works in VSCode extensions)
import Parser from 'web-tree-sitter';

/**
 * Supported languages for AST validation
 */
export type SupportedLanguage = 
  | 'typescript' 
  | 'javascript' 
  | 'python' 
  | 'go' 
  | 'rust' 
  | 'html' 
  | 'php'
  | 'tsx'
  | 'jsx';

/**
 * Language to WASM file mapping
 */
const LANGUAGE_WASM_FILES: Record<SupportedLanguage, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-typescript.wasm', // TSX uses same parser as TypeScript
  javascript: 'tree-sitter-javascript.wasm',
  jsx: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  html: 'tree-sitter-html.wasm',
  php: 'tree-sitter-php.wasm',
};

/**
 * AST Validator using Tree-sitter
 */
export class ASTValidator {
  private parsers: Map<SupportedLanguage, Parser> = new Map();
  private initialized: boolean = false;
  private cache: Map<string, ValidationCacheEntry> = new Map();
  private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes
  private wasmPath: string;

  constructor(wasmPath?: string) {
    // Default to extension's resources/wasm folder
    this.wasmPath = wasmPath || path.join(__dirname, '..', '..', '..', 'resources', 'wasm');
  }

  /**
   * Initialize Tree-sitter and load language parsers
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      console.log('[ASTValidator] Initializing Tree-sitter...');

      // Initialize web-tree-sitter (WebAssembly)
      await Parser.init();
      this.initialized = true;

      console.log('[ASTValidator] Tree-sitter initialized successfully');
    } catch (error) {
      console.error('[ASTValidator] Failed to initialize Tree-sitter:', error);
      throw new Error(`Failed to initialize AST validator: ${error}`);
    }
  }

  /**
   * Get or create parser for a language
   */
  private async getParser(language: SupportedLanguage): Promise<Parser | null> {
    // Check cache
    if (this.parsers.has(language)) {
      return this.parsers.get(language)!;
    }

    // Check if parser is already marked as unavailable
    if (this.parsers.has(language) && this.parsers.get(language) === null) {
      return null;
    }

    try {
      // Create parser instance
      const parser = new Parser();
      const wasmFile = LANGUAGE_WASM_FILES[language];

      if (!wasmFile) {
        console.warn(`[ASTValidator] No WASM file configured for language: ${language}`);
        this.parsers.set(language, null as any); // Mark as unavailable
        return null;
      }

      // Load language grammar
      const wasmFilePath = path.join(this.wasmPath, wasmFile);
      console.log(`[ASTValidator] Loading grammar for ${language} from ${wasmFilePath}`);

      const lang = await Parser.Language.load(wasmFilePath);
      parser.setLanguage(lang);

      // Cache parser
      this.parsers.set(language, parser);
      console.log(`[ASTValidator] Parser loaded for ${language}`);

      return parser;
    } catch (error) {
      console.warn(`[ASTValidator] Parser not available for ${language}, skipping AST validation`);
      // Mark as unavailable to avoid repeated attempts
      this.parsers.set(language, null as any);
      return null;
    }
  }

  /**
   * Validate code syntax using AST parsing
   */
  async validateSyntax(
    code: string, 
    language: string,
    filePath?: string
  ): Promise<ValidationResult> {
    const startTime = Date.now();

    // Ensure initialized
    if (!this.initialized) {
      await this.initialize();
    }

    // Normalize language
    const normalizedLang = this.normalizeLanguage(language);
    
    // Check if language is supported
    if (!this.isLanguageSupported(normalizedLang)) {
      console.log(`[ASTValidator] Language not supported: ${language}, skipping validation`);
      return {
        valid: true,
        errors: [],
        warnings: [{
          message: `AST validation not available for ${language}`,
          code: 'UNSUPPORTED_LANGUAGE',
          source: 'ASTValidator'
        }],
        metadata: {
          validator: 'ASTValidator',
          language: normalizedLang,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }

    // Check cache
    const cacheKey = this.getCacheKey(code, normalizedLang);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[ASTValidator] Cache hit for ${normalizedLang}`);
      return {
        ...cached,
        metadata: {
          ...cached.metadata!,
          cacheHit: true
        }
      };
    }

    try {
      // Get parser
      const parser = await this.getParser(normalizedLang as SupportedLanguage);
      if (!parser) {
        // Parser not available, return valid with warning
        console.log(`[ASTValidator] Parser not available for ${normalizedLang}, skipping validation`);
        return {
          valid: true,
          errors: [],
          warnings: [{
            message: `AST validation not available for ${normalizedLang} (parser not loaded)`,
            code: 'PARSER_NOT_AVAILABLE',
            source: 'ASTValidator'
          }],
          metadata: {
            validator: 'ASTValidator',
            language: normalizedLang,
            duration: Date.now() - startTime,
            timestamp: Date.now()
          }
        };
      }

      // Parse code
      const tree = parser.parse(code);
      
      // Extract syntax errors
      const errors = this.extractSyntaxErrors(tree, code, filePath);

      const result: ValidationResult = {
        valid: errors.length === 0,
        errors,
        metadata: {
          validator: 'ASTValidator',
          language: normalizedLang,
          duration: Date.now() - startTime,
          timestamp: Date.now(),
          cacheHit: false
        }
      };

      // Cache result
      this.addToCache(cacheKey, result, code);

      console.log(`[ASTValidator] Validation complete for ${normalizedLang}: ${errors.length} errors`);
      return result;

    } catch (error) {
      console.error(`[ASTValidator] Validation error:`, error);
      return {
        valid: false,
        errors: [{
          type: 'syntax',
          message: `AST validation failed: ${error}`,
          severity: 'error',
          source: 'ASTValidator'
        }],
        metadata: {
          validator: 'ASTValidator',
          language: normalizedLang,
          duration: Date.now() - startTime,
          timestamp: Date.now()
        }
      };
    }
  }

  /**
   * Extract syntax errors from Tree-sitter parse tree
   */
  private extractSyntaxErrors(
    tree: any,
    code: string,
    filePath?: string
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = code.split('\n');

    // Traverse tree and find ERROR nodes
    const cursor = tree.walk();
    
    const traverse = () => {
      const node = cursor.currentNode;
      
      // Check for ERROR or MISSING nodes
      if (node.type === 'ERROR' || node.isMissing) {
        const startPos = node.startPosition;
        const endPos = node.endPosition;
        
        // Get context around error
        const errorLine = lines[startPos.row] || '';
        const errorContext = errorLine.substring(
          Math.max(0, startPos.column - 20),
          Math.min(errorLine.length, startPos.column + 20)
        );

        errors.push({
          type: 'syntax',
          message: node.isMissing 
            ? `Missing ${node.type}` 
            : `Syntax error: unexpected token`,
          line: startPos.row + 1, // 1-based
          column: startPos.column + 1,
          endLine: endPos.row + 1,
          endColumn: endPos.column + 1,
          severity: 'error',
          code: 'SYNTAX_ERROR',
          source: filePath || 'unknown',
          suggestion: `Check syntax near: "${errorContext}"`
        });
      }

      // Traverse children
      if (cursor.gotoFirstChild()) {
        do {
          traverse();
        } while (cursor.gotoNextSibling());
        cursor.gotoParent();
      }
    };

    traverse();

    return errors;
  }

  /**
   * Normalize language identifier
   */
  private normalizeLanguage(language: string): string {
    const normalized = language.toLowerCase().trim();
    
    // Handle common aliases
    const aliases: Record<string, string> = {
      'ts': 'typescript',
      'js': 'javascript',
      'py': 'python',
      'typescriptreact': 'tsx',
      'javascriptreact': 'jsx'
    };

    return aliases[normalized] || normalized;
  }

  /**
   * Check if language is supported
   */
  private isLanguageSupported(language: string): boolean {
    return language in LANGUAGE_WASM_FILES;
  }

  /**
   * Generate cache key
   */
  private getCacheKey(code: string, language: string): string {
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
   * Clear validation cache
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[ASTValidator] Cache cleared');
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

