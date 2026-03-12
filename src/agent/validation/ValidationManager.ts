/**
 * Validation Manager
 * 
 * Orchestrates all validation steps (AST, Type-Checking, Linting)
 * and implements auto-retry with LLM for fixing validation errors.
 */

import { ASTValidator } from './ASTValidator';
import { TypeChecker } from './TypeChecker';
import { LintValidator } from './LintValidator';
import {
  IValidationManager,
  ValidationResult,
  ValidationError,
  ValidationConfig,
  ValidationMetrics,
  CodeFixSuggestion,
  ValidationRetryContext
} from './types';
import { OpenRouterService } from '../../services/OpenRouterService';

/**
 * Default validation configuration
 */
const DEFAULT_CONFIG: ValidationConfig = {
  enabled: true,
  strictMode: false,
  enableSyntaxValidation: true,
  enableTypeChecking: true,
  enableLinting: false, // Non-blocking by default
  maxRetries: 3,
  timeout: 30000, // 30 seconds
  languages: {
    typescript: {
      enabled: true,
      syntaxValidation: true,
      typeChecking: true,
      linting: true
    },
    javascript: {
      enabled: true,
      syntaxValidation: true,
      typeChecking: false,
      linting: true
    },
    python: {
      enabled: true,
      syntaxValidation: true,
      typeChecking: true,
      linting: true
    }
  }
};

/**
 * Validation Manager
 */
export class ValidationManager implements IValidationManager {
  private astValidator: ASTValidator;
  private typeChecker?: TypeChecker;
  private lintValidator?: LintValidator;
  private config: ValidationConfig;
  private metrics: ValidationMetrics;
  private openRouterService: OpenRouterService;
  private workspaceRoot: string;

  constructor(
    openRouterService: OpenRouterService,
    workspaceRoot: string,
    config?: Partial<ValidationConfig>
  ) {
    this.openRouterService = openRouterService;
    this.workspaceRoot = workspaceRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.astValidator = new ASTValidator();
    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize validation metrics
   */
  private initializeMetrics(): ValidationMetrics {
    return {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      retriesCount: 0,
      averageDuration: 0,
      cacheHitRate: 0,
      errorsByType: {
        syntax: 0,
        type: 0,
        lint: 0,
        semantic: 0
      }
    };
  }

  /**
   * Initialize validators
   */
  async initialize(): Promise<void> {
    console.log('[ValidationManager] Initializing validators...');
    await this.astValidator.initialize();

    // Initialize TypeChecker if enabled
    if (this.config.enableTypeChecking) {
      this.typeChecker = new TypeChecker(this.workspaceRoot);
      console.log('[ValidationManager] TypeChecker initialized');
    }

    // Initialize LintValidator if enabled
    if (this.config.enableLinting) {
      this.lintValidator = new LintValidator(this.workspaceRoot);
      await this.lintValidator.initialize();
      console.log('[ValidationManager] LintValidator initialized');
    }

    console.log('[ValidationManager] Validators initialized');
  }

  /**
   * Validate code with auto-retry on errors
   */
  async validateCode(
    code: string,
    language: string,
    filePath?: string
  ): Promise<ValidationResult> {
    if (!this.config.enabled) {
      return {
        valid: true,
        errors: [],
        warnings: [{ message: 'Validation disabled', source: 'ValidationManager' }]
      };
    }

    const startTime = Date.now();
    this.metrics.totalValidations++;

    try {
      // Run validation pipeline
      const result = await this.runValidationPipeline(code, language, filePath);

      // Update metrics
      if (result.valid) {
        this.metrics.successfulValidations++;
      } else {
        this.metrics.failedValidations++;
      }

      this.updateAverageDuration(Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[ValidationManager] Validation error:', error);
      this.metrics.failedValidations++;

      return {
        valid: false,
        errors: [{
          type: 'syntax',
          message: `Validation failed: ${error}`,
          severity: 'error',
          source: 'ValidationManager'
        }]
      };
    }
  }

  /**
   * Validate code with automatic retry and LLM-based fixing
   */
  async validateWithRetry(
    code: string,
    language: string,
    filePath?: string,
    onRetry?: (attempt: number, errors: ValidationError[]) => void
  ): Promise<{ valid: boolean; code: string; result: ValidationResult; retries: number }> {
    let currentCode = code;
    let attempt = 0;
    const maxAttempts = this.config.maxRetries;
    const retryContext: ValidationRetryContext = {
      attempt: 0,
      maxAttempts,
      previousErrors: [],
      previousCode: code,
      llmFixAttempts: []
    };

    while (attempt < maxAttempts) {
      attempt++;
      retryContext.attempt = attempt;

      console.log(`[ValidationManager] Validation attempt ${attempt}/${maxAttempts}`);

      // Validate current code
      const result = await this.validateCode(currentCode, language, filePath);

      // Success!
      if (result.valid) {
        console.log(`[ValidationManager] Validation successful on attempt ${attempt}`);
        return {
          valid: true,
          code: currentCode,
          result,
          retries: attempt - 1
        };
      }

      // Last attempt failed
      if (attempt >= maxAttempts) {
        console.log(`[ValidationManager] Max retries reached (${maxAttempts})`);
        return {
          valid: false,
          code: currentCode,
          result,
          retries: attempt - 1
        };
      }

      // Try to fix with LLM
      console.log(`[ValidationManager] Attempting LLM fix (${result.errors.length} errors)`);

      if (onRetry) {
        onRetry(attempt, result.errors);
      }

      try {
        const fixSuggestion = await this.fixCodeWithLLM(
          currentCode,
          result.errors,
          language,
          retryContext
        );

        if (fixSuggestion) {
          currentCode = fixSuggestion.fixedCode;
          retryContext.previousErrors = result.errors;
          retryContext.previousCode = currentCode;
          retryContext.llmFixAttempts.push(fixSuggestion);
          this.metrics.retriesCount++;
        } else {
          // LLM couldn't fix, abort
          console.log('[ValidationManager] LLM could not generate fix');
          return {
            valid: false,
            code: currentCode,
            result,
            retries: attempt - 1
          };
        }
      } catch (error) {
        console.error('[ValidationManager] LLM fix failed:', error);
        return {
          valid: false,
          code: currentCode,
          result,
          retries: attempt - 1
        };
      }
    }

    // Should not reach here
    const finalResult = await this.validateCode(currentCode, language, filePath);
    return {
      valid: false,
      code: currentCode,
      result: finalResult,
      retries: maxAttempts
    };
  }

  /**
   * Run validation pipeline
   */
  private async runValidationPipeline(
    code: string,
    language: string,
    filePath?: string
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: any[] = [];

    // 1. AST Syntax Validation (MUST pass)
    if (this.config.enableSyntaxValidation) {
      const syntaxResult = await this.astValidator.validateSyntax(code, language, filePath);

      if (!syntaxResult.valid) {
        errors.push(...syntaxResult.errors);
        syntaxResult.errors.forEach(err => {
          if (err.type === 'syntax') {
            this.metrics.errorsByType.syntax++;
          }
        });
      }

      if (syntaxResult.warnings) {
        warnings.push(...syntaxResult.warnings);
      }

      // In strict mode, syntax errors are blocking
      if (this.config.strictMode && errors.length > 0) {
        return {
          valid: false,
          errors,
          warnings,
          metadata: syntaxResult.metadata
        };
      }
    }

    // 2. Type Checking (SHOULD pass for TypeScript)
    if (this.config.enableTypeChecking && this.typeChecker) {
      const typeResult = await this.typeChecker.checkTypes(code, language, filePath);

      if (!typeResult.valid) {
        errors.push(...typeResult.errors);
        typeResult.errors.forEach(err => {
          if (err.type === 'type') {
            this.metrics.errorsByType.type++;
          }
        });
      }

      if (typeResult.warnings) {
        warnings.push(...typeResult.warnings);
      }

      // In strict mode, type errors are blocking
      if (this.config.strictMode && typeResult.errors.length > 0) {
        return {
          valid: false,
          errors,
          warnings,
          metadata: typeResult.metadata
        };
      }
    }

    // 3. Linting (SHOULD pass, but not blocking by default)
    if (this.config.enableLinting && this.lintValidator) {
      const lintResult = await this.lintValidator.lint(code, language, filePath);

      if (!lintResult.valid) {
        // In strict mode, lint errors are blocking
        if (this.config.strictMode) {
          errors.push(...lintResult.errors);
        } else {
          // In non-strict mode, lint errors become warnings
          warnings.push(...lintResult.errors.map(err => ({
            message: err.message,
            line: err.line,
            column: err.column,
            code: err.code,
            source: err.source
          })));
        }

        lintResult.errors.forEach(err => {
          if (err.type === 'lint') {
            this.metrics.errorsByType.lint++;
          }
        });
      }

      if (lintResult.warnings) {
        warnings.push(...lintResult.warnings);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Fix code using LLM
   */
  private async fixCodeWithLLM(
    code: string,
    errors: ValidationError[],
    language: string,
    context: ValidationRetryContext
  ): Promise<CodeFixSuggestion | null> {
    try {
      const prompt = this.buildFixPrompt(code, errors, language, context);

      console.log('[ValidationManager] Sending fix request to LLM...');

      const response = await this.openRouterService.sendChatMessage({
        messages: [
          {
            role: 'system',
            content: 'You are an expert code fixer. Fix syntax and validation errors in code. Return ONLY the fixed code, no explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        model: 'deepseek/deepseek-chat',
        stream: false,
        temperature: 0.2, // Low temperature for precise fixes
        max_tokens: 2000
      });

      const responseData = await response.json() as any;
      const fixedCode = responseData.choices?.[0]?.message?.content;

      if (!fixedCode) {
        return null;
      }

      // Extract code from markdown if present
      const cleanedCode = this.extractCodeFromMarkdown(fixedCode, language);

      return {
        originalCode: code,
        fixedCode: cleanedCode,
        explanation: 'LLM-generated fix',
        confidence: 0.8,
        appliedFixes: errors.map(e => e.message)
      };
    } catch (error) {
      console.error('[ValidationManager] LLM fix error:', error);
      return null;
    }
  }

  /**
   * Build prompt for LLM to fix code
   */
  private buildFixPrompt(
    code: string,
    errors: ValidationError[],
    language: string,
    context: ValidationRetryContext
  ): string {
    const errorList = errors.map((err, i) =>
      `${i + 1}. Line ${err.line}: ${err.message}`
    ).join('\n');

    return `Fix the following ${language} code. It has ${errors.length} validation error(s):

ERRORS:
${errorList}

CODE:
\`\`\`${language}
${code}
\`\`\`

Return ONLY the fixed code without any explanations or markdown formatting.`;
  }

  /**
   * Extract code from markdown code blocks
   */
  private extractCodeFromMarkdown(text: string, language: string): string {
    // Try to extract from markdown code block
    const codeBlockRegex = new RegExp(`\`\`\`(?:${language})?\\s*([\\s\\S]*?)\`\`\``, 'i');
    const match = text.match(codeBlockRegex);

    if (match && match[1]) {
      return match[1].trim();
    }

    // No code block found, return as-is
    return text.trim();
  }

  /**
   * Update average duration metric
   */
  private updateAverageDuration(duration: number): void {
    const total = this.metrics.totalValidations;
    const currentAvg = this.metrics.averageDuration;
    this.metrics.averageDuration = ((currentAvg * (total - 1)) + duration) / total;
  }

  /**
   * Get validation metrics
   */
  getMetrics(): ValidationMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ValidationConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[ValidationManager] Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): ValidationConfig {
    return { ...this.config };
  }
}

