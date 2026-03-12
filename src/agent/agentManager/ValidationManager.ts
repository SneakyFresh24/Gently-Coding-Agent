// =====================================================
// ValidationManager - Refactored Validation Management
// =====================================================

import {
  ValidationManager as BaseValidationManager
} from '../validation';
import { IValidationManager } from '../validation/IValidationManager';
import { ValidationResult, ValidationError } from '../validation/types';
import { IAgentService } from './interfaces';

export class ValidationManager implements IAgentService, IValidationManager {
  // Core validation component
  private baseValidationManager: BaseValidationManager;

  // Configuration
  private debug: boolean = false;

  constructor(baseValidationManager: BaseValidationManager) {
    this.baseValidationManager = baseValidationManager;
  }

  async initialize(): Promise<void> {
    try {
      await this.baseValidationManager.initialize();

      if (this.debug) {
        console.log('[ValidationManager] Initialized successfully');
      }
    } catch (error) {
      console.error('[ValidationManager] Initialization failed:', error);
      throw error;
    }
  }

  dispose(): void {
    // Validation manager cleanup is handled by the base class
    if (this.debug) {
      console.log('[ValidationManager] Disposed successfully');
    }
  }

  // ==================== VALIDATION OPERATIONS ====================

  /**
   * Validate code content
   */
  async validateCode(content: string, language: string, filePath?: string): Promise<any> {
    return await this.baseValidationManager.validateCode(content, language, filePath);
  }

  /**
   * Validate with retry logic
   */
  async validateWithRetry(
    content: string,
    language: string,
    filePath?: string,
    onRetry?: (attempt: number, errors: any[]) => void
  ): Promise<any> {
    return await this.baseValidationManager.validateWithRetry(content, language, filePath, onRetry);
  }

  /**
   * Set validation message callback
   */
  setMessageCallback(callback: (message: any) => void): void {
    // ValidationManager doesn't have setMessageCallback method
    // This functionality is handled by the FileOperations class
    console.warn('[ValidationManager] setMessageCallback is not implemented in base ValidationManager');
  }

  // ==================== VALIDATION METRICS ====================

  /**
   * Get validation metrics
   */
  getValidationMetrics(): any {
    return this.baseValidationManager.getMetrics();
  }

  /**
   * Get validation statistics
   */
  getValidationStats(): {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    averageValidationTime: number;
    languagesSupported: string[];
    lastValidationTime: number;
  } {
    const metrics = this.getValidationMetrics();

    return {
      totalValidations: metrics?.totalValidations || 0,
      successfulValidations: metrics?.successfulValidations || 0,
      failedValidations: metrics?.failedValidations || 0,
      averageValidationTime: metrics?.averageValidationTime || 0,
      languagesSupported: metrics?.languagesSupported || [],
      lastValidationTime: metrics?.lastValidationTime || 0
    };
  }

  /**
   * Get validation errors summary
   */
  getValidationErrorSummary(): {
    totalErrors: number;
    errorsByType: Record<string, number>;
    errorsByFile: Record<string, number>;
    topErrorMessages: string[];
  } {
    const metrics = this.getValidationMetrics();

    return {
      totalErrors: metrics?.totalErrors || 0,
      errorsByType: metrics?.errorsByType || {},
      errorsByFile: metrics?.errorsByFile || {},
      topErrorMessages: metrics?.topErrorMessages || []
    };
  }

  // ==================== VALIDATION SETTINGS ====================

  /**
   * Update validation settings
   */
  updateSettings(settings: {
    enabled?: boolean;
    strictMode?: boolean;
    enableSyntaxValidation?: boolean;
    enableTypeChecking?: boolean;
    enableLinting?: boolean;
    maxRetries?: number;
    timeout?: number;
    languages?: Record<string, any>;
  }): void {
    // ValidationManager doesn't have getSettings/updateSettings methods
    // Settings are managed during initialization
    console.warn('[ValidationManager] Settings management is not implemented in base ValidationManager');
  }

  /**
   * Get current validation settings
   */
  getSettings(): any {
    // ValidationManager doesn't have getSettings method
    return {
      enabled: true,
      strictMode: false,
      enableSyntaxValidation: true,
      enableTypeChecking: true,
      enableLinting: false,
      maxRetries: 1,
      timeout: 30000,
      languages: {}
    };
  }

  /**
   * Check if validation is enabled for a language
   */
  isLanguageSupported(language: string): boolean {
    const settings = this.getSettings();
    return settings?.languages?.[language]?.enabled ?? true;
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[] {
    const settings = this.getSettings();
    return Object.keys(settings?.languages || {}).filter(lang =>
      settings.languages[lang].enabled !== false
    );
  }

  // ==================== VALIDATION RESULTS ====================

  /**
   * Process validation results
   */
  processValidationResults(results: any): {
    valid: boolean;
    errors: any[];
    warnings: any[];
    fixedCode?: string;
    validationTime: number;
  } {
    const validationTime = Date.now();

    if (!results) {
      return {
        valid: false,
        errors: [{ message: 'No validation results' }],
        warnings: [],
        validationTime
      };
    }

    if (results.valid) {
      return {
        valid: true,
        errors: [],
        warnings: results.warnings || [],
        fixedCode: results.code,
        validationTime
      };
    }

    return {
      valid: false,
      errors: results.errors || [],
      warnings: results.warnings || [],
      fixedCode: results.code,
      validationTime
    };
  }

  /**
   * Format validation errors for display
   */
  formatValidationErrors(errors: any[], filePath?: string): string {
    if (!errors || errors.length === 0) {
      return 'No validation errors found.';
    }

    let message = `Validation errors found in ${filePath || 'file'}:\n\n`;

    errors.forEach((error, index) => {
      message += `${index + 1}. ${error.message}\n`;
      if (error.line !== undefined) {
        message += `   Line ${error.line}`;
        if (error.column !== undefined) {
          message += `, Column ${error.column}`;
        }
        message += '\n';
      }
      if (error.severity) {
        message += `   Severity: ${error.severity}\n`;
      }
      message += '\n';
    });

    return message;
  }

  // ==================== VALIDATION CACHE ====================

  /**
   * Clear validation cache
   */
  clearValidationCache(): void {
    // ValidationManager doesn't have clearCache method
    console.warn('[ValidationManager] clearCache is not implemented in base ValidationManager');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    enabled: boolean;
    hits: number;
    misses: number;
    size: number;
    hitRate: number;
  } {
    // ValidationManager doesn't have getCache method
    console.warn('[ValidationManager] getCache is not implemented in base ValidationManager');
    return {
      enabled: false,
      hits: 0,
      misses: 0,
      size: 0,
      hitRate: 0
    };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Enable/disable debug logging
   */
  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  /**
   * Get base validation manager instance
   */
  getBaseValidationManager(): BaseValidationManager {
    return this.baseValidationManager;
  }

  /**
   * Check if validation manager is initialized
   */
  isInitialized(): boolean {
    // This is a simple check - in a real implementation, you might want to track initialization state
    const settings = this.getSettings();
    return settings !== undefined;
  }

  /**
   * Get validation health status
   */
  getHealthStatus(): {
    healthy: boolean;
    status: 'ok' | 'degraded' | 'error';
    issues: string[];
    lastCheck: number;
  } {
    const issues: string[] = [];
    const lastCheck = Date.now();

    try {
      const settings = this.getSettings();
      if (!settings) {
        issues.push('Validation settings not available');
      }

      const stats = this.getValidationStats();
      if (stats.failedValidations > stats.successfulValidations) {
        issues.push('More failed validations than successful ones');
      }

      const cacheStats = this.getCacheStats();
      if (cacheStats.enabled && cacheStats.hitRate < 10) {
        issues.push('Very low validation cache hit rate');
      }

      const status: 'ok' | 'degraded' | 'error' = issues.length === 0 ? 'ok' :
        issues.length === 1 ? 'degraded' : 'error';

      return {
        healthy: issues.length === 0,
        status,
        issues,
        lastCheck
      };
    } catch (error) {
      return {
        healthy: false,
        status: 'error',
        issues: [`Validation manager error: ${error}`],
        lastCheck
      };
    }
  }
}