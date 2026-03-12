/**
 * Validation Types
 * 
 * Type definitions for the code validation system
 */

import { CodeChunk } from '../ASTAnalyzer';
import { IValidationManager } from './IValidationManager';

export { IValidationManager };

/**
 * Validation result from any validator
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: ValidationWarning[];
  fixedCode?: string; // Auto-fixed code (from linter)
  metadata?: ValidationMetadata;
}

/**
 * Validation error with detailed information
 */
export interface ValidationError {
  type: 'syntax' | 'type' | 'lint' | 'semantic';
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning';
  code?: string;
  source?: string;
  suggestion?: string;
}

/**
 * Validation warning (non-blocking)
 */
export interface ValidationWarning {
  message: string;
  line?: number;
  column?: number;
  code?: string;
  source?: string;
}

/**
 * Metadata about the validation process
 */
export interface ValidationMetadata {
  validator: string;
  language: string;
  duration: number;
  timestamp: number;
  cacheHit?: boolean;
}

/**
 * Validation configuration
 */
export interface ValidationConfig {
  enabled: boolean;
  strictMode: boolean;
  enableSyntaxValidation: boolean;
  enableTypeChecking: boolean;
  enableLinting: boolean;
  maxRetries: number;
  timeout: number;
  languages: {
    [language: string]: LanguageValidationConfig;
  };
}

/**
 * Language-specific validation configuration
 */
export interface LanguageValidationConfig {
  enabled: boolean;
  syntaxValidation: boolean;
  typeChecking: boolean;
  linting: boolean;
  customRules?: any;
}

/**
 * Validation metrics for tracking
 */
export interface ValidationMetrics {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  retriesCount: number;
  averageDuration: number;
  cacheHitRate: number;
  errorsByType: {
    syntax: number;
    type: number;
    lint: number;
    semantic: number;
  };
}

/**
 * Validation cache entry
 */
export interface ValidationCacheEntry {
  result: ValidationResult;
  contentHash: string;
  timestamp: number;
  expiresAt: number;
}

/**
 * Code fix suggestion from LLM
 */
export interface CodeFixSuggestion {
  originalCode: string;
  fixedCode: string;
  explanation: string;
  confidence: number;
  appliedFixes: string[];
}

/**
 * Validation retry context
 */
export interface ValidationRetryContext {
  attempt: number;
  maxAttempts: number;
  previousErrors: ValidationError[];
  previousCode: string;
  llmFixAttempts: CodeFixSuggestion[];
}
