// =====================================================
// Error Handler - Centralized error handling
// =====================================================

import { ERROR_MESSAGES } from './constants';

/**
 * Custom error classes for better error handling
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export class ToolError extends AgentError {
  constructor(
    toolName: string,
    message: string,
    details?: any
  ) {
    super(`Tool '${toolName}' error: ${message}`, 'TOOL_ERROR', details);
    this.name = 'ToolError';
  }
}

export class FileError extends AgentError {
  constructor(
    filePath: string,
    message: string,
    details?: any
  ) {
    super(`File '${filePath}' error: ${message}`, 'FILE_ERROR', details);
    this.name = 'FileError';
  }
}

export class MemoryError extends AgentError {
  constructor(
    memoryId: string,
    message: string,
    details?: any
  ) {
    super(`Memory '${memoryId}' error: ${message}`, 'MEMORY_ERROR', details);
    this.name = 'MemoryError';
  }
}

export class ValidationError extends AgentError {
  constructor(
    message: string,
    details?: any
  ) {
    super(`Validation error: ${message}`, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class NetworkError extends AgentError {
  constructor(
    message: string,
    details?: any
  ) {
    super(`Network error: ${message}`, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

/**
 * Error handler utility class
 */
export class ErrorHandler {
  /**
   * Handle and log errors consistently
   */
  static handle(error: Error, context?: string): void {
    const contextMsg = context ? `[${context}]` : '';

    if (error instanceof AgentError) {
      console.error(`${contextMsg} ${error.name}: ${error.message}`, error.details);
    } else {
      console.error(`${contextMsg} Error: ${error.message}`, error.stack);
    }
  }

  /**
   * Handle and rethrow errors with additional context
   */
  static handleAndRethrow(error: Error, context?: string): never {
    this.handle(error, context);
    throw error;
  }

  /**
   * Create a standardized error response
   */
  static createErrorResponse(error: Error, context?: string): {
    success: false;
    error: string;
    code?: string;
    details?: any;
  } {
    this.handle(error, context);

    if (error instanceof AgentError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      };
    } else {
      return {
        success: false,
        error: error.message,
        code: 'UNKNOWN_ERROR'
      };
    }
  }

  /**
   * Wrap async functions with error handling
   */
  static async wrapAsync<T>(
    fn: () => Promise<T>,
    context?: string
  ): Promise<{ success: true; data: T } | { success: false; error: string; code?: string; details?: any }> {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (error) {
      return this.createErrorResponse(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
    }
  }

  /**
   * Wrap sync functions with error handling
   */
  static wrapSync<T>(
    fn: () => T,
    context?: string
  ): { success: true; data: T } | { success: false; error: string; code?: string; details?: any } {
    try {
      const data = fn();
      return { success: true, data };
    } catch (error) {
      return this.createErrorResponse(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
    }
  }

  /**
   * Check if an error is recoverable
   */
  static isRecoverable(error: Error): boolean {
    if (error instanceof NetworkError) {
      return true; // Network errors might be recoverable
    }

    if (error instanceof AgentError) {
      return error.code !== 'VALIDATION_ERROR' && error.code !== 'FILE_ERROR';
    }

    return false;
  }

  /**
   * Get user-friendly error message
   */
  static getUserFriendlyMessage(error: Error): string {
    if (error instanceof AgentError) {
      return error.message;
    }

    // Map common error types to user-friendly messages
    if (error.message.includes('ENOENT')) {
      return ERROR_MESSAGES.FILE_NOT_FOUND('Unknown file');
    }

    if (error.message.includes('EACCES')) {
      return ERROR_MESSAGES.PERMISSION_DENIED('access file');
    }

    if (error.message.includes('timeout')) {
      return ERROR_MESSAGES.TIMEOUT('operation', 30000);
    }

    return error.message || ERROR_MESSAGES.NETWORK_ERROR;
  }
}

/**
 * Error boundary decorator for methods
 */
export function handleErrors(context?: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        const result = originalMethod.apply(this, args);
        if (result instanceof Promise) {
          return await result;
        }
        return result;
      } catch (error) {
        const className = this?.constructor?.name || target.constructor.name;
        const fullContext = context || `${className}.${propertyName}`;
        ErrorHandler.handle(error instanceof Error ? error : new Error(String(error)), fullContext);
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Safe execution utility
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  fallback?: T,
  context?: string
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    ErrorHandler.handle(error instanceof Error ? error : new Error(String(error)), context);
    return fallback;
  }
}

/**
 * Retry utility for recoverable errors
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
  context?: string,
  shouldRetry?: (error: Error) => boolean
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const isRecoverable = ErrorHandler.isRecoverable(lastError);
      const userAllowsRetry = shouldRetry ? shouldRetry(lastError) : true;

      if (i === maxRetries || !isRecoverable || !userAllowsRetry) {
        break;
      }

      console.warn(`${context || 'Retry'}: Attempt ${i + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2; // Exponential backoff
    }
  }

  throw lastError!;
}