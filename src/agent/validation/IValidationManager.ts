/**
 * IValidationManager Interface
 */

import { ValidationResult, ValidationError } from './types';

export interface IValidationManager {
    validateWithRetry(
        code: string,
        language: string,
        filePath?: string,
        onRetry?: (attempt: number, errors: ValidationError[]) => void
    ): Promise<{ valid: boolean; code: string; result: ValidationResult; retries: number }>;

    getValidationMetrics?(): any;
    dispose?(): void;
}
