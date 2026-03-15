// =====================================================
// Message Validator - Robust Input Validation Framework
// =====================================================

import * as vscode from 'vscode';
import {
  InboundWebviewMessage,
  OutboundWebviewMessage,
  WebviewMessage
} from '../types/WebviewMessageTypes';

// =====================================================
// Validation Result Types
// =====================================================

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  sanitizedData?: any;
  sanitizedValue?: any;
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'critical' | 'error' | 'warning';
}

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
}

export interface ValidationConfig {
  enableRateLimit: boolean;
  maxMessageSize: number;
  rateLimitWindow: number; // in milliseconds
  maxMessagesPerWindow: number;
  enableSanitization: boolean;
  enableSecurityLogging: boolean;
}

// =====================================================
// Security Logger
// =====================================================

class SecurityLogger {
  private readonly outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Webview Security');
  }

  logSecurityEvent(event: string, details: any, severity: 'info' | 'warning' | 'error' = 'warning'): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${severity.toUpperCase()}] ${event}: ${JSON.stringify(details)}`;

    this.outputChannel.appendLine(logEntry);

    if (severity === 'error') {
      console.error(`[WebviewSecurity] ${event}:`, details);
    } else if (severity === 'warning') {
      console.warn(`[WebviewSecurity] ${event}:`, details);
    } else {
      console.log(`[WebviewSecurity] ${event}:`, details);
    }
  }

  showToUser(message: string, severity: 'info' | 'warning' | 'error' = 'warning'): void {
    if (severity === 'error') {
      vscode.window.showErrorMessage(message);
    } else if (severity === 'warning') {
      vscode.window.showWarningMessage(message);
    } else {
      vscode.window.showInformationMessage(message);
    }
  }
}

// =====================================================
// Rate Limiter
// =====================================================

class RateLimiter {
  private messageTimestamps: number[] = [];
  private readonly config: ValidationConfig;

  constructor(config: ValidationConfig) {
    this.config = config;
  }

  isAllowed(): boolean {
    if (!this.config.enableRateLimit) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;

    // Remove old timestamps
    this.messageTimestamps = this.messageTimestamps.filter(
      timestamp => timestamp > windowStart
    );

    // Check if limit exceeded
    if (this.messageTimestamps.length >= this.config.maxMessagesPerWindow) {
      return false;
    }

    // Add current timestamp
    this.messageTimestamps.push(now);
    return true;
  }

  getTimeUntilNextMessage(): number {
    if (!this.config.enableRateLimit || this.messageTimestamps.length === 0) {
      return 0;
    }

    const oldestTimestamp = Math.min(...this.messageTimestamps);
    const windowEnd = oldestTimestamp + this.config.rateLimitWindow;
    return Math.max(0, windowEnd - Date.now());
  }

  reset(): void {
    this.messageTimestamps = [];
  }
}

// =====================================================
// Input Sanitizer
// =====================================================

class InputSanitizer {
  sanitizeString(input: string, maxLength?: number): string {
    if (typeof input !== 'string') {
      return '';
    }

    let sanitized = input.trim();

    // Remove potentially dangerous characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, ''); // Control characters
    sanitized = sanitized.replace(/[\uFFFE\uFFFF]/g, ''); // Invalid Unicode

    // Limit length if specified
    if (maxLength && sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
  }

  sanitizeFilePath(filePath: string): string {
    if (typeof filePath !== 'string') {
      return '';
    }

    // Remove path traversal attempts
    let sanitized = filePath.replace(/\.\./g, '');
    sanitized = sanitized.replace(/[\\/]/g, '/'); // Normalize separators

    // Remove leading slashes to prevent absolute paths
    sanitized = sanitized.replace(/^\/+/, '');

    return this.sanitizeString(sanitized, 1000);
  }

  sanitizeEmail(email: string): string {
    if (typeof email !== 'string') {
      return '';
    }

    // Basic email sanitization
    const sanitized = email.toLowerCase().trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

    return emailRegex.test(sanitized) ? sanitized : '';
  }

  sanitizeJson(jsonString: string): any {
    try {
      // Parse and re-serialize to remove any malicious content
      const parsed = JSON.parse(jsonString);
      return JSON.parse(JSON.stringify(parsed));
    } catch {
      return null;
    }
  }
}

// =====================================================
// Type Guards
// =====================================================

export class TypeGuards {
  static isInboundMessage(data: any): data is InboundWebviewMessage {
    return data && typeof data === 'object' && typeof data.type === 'string';
  }

  static isOutboundMessage(data: any): data is OutboundWebviewMessage {
    return data && typeof data === 'object' && typeof data.type === 'string';
  }

  static isWebviewMessage(data: any): data is WebviewMessage {
    return this.isInboundMessage(data) || this.isOutboundMessage(data);
  }

  static isValidMessageType(data: any, validTypes: string[]): boolean {
    return data && typeof data.type === 'string' && validTypes.includes(data.type);
  }

  static isValidString(value: any, maxLength?: number): boolean {
    return typeof value === 'string' && (!maxLength || value.length <= maxLength);
  }

  static isValidBoolean(value: any): boolean {
    return typeof value === 'boolean';
  }

  static isValidNumber(value: any, min?: number, max?: number): boolean {
    return typeof value === 'number' &&
      !isNaN(value) &&
      (min === undefined || value >= min) &&
      (max === undefined || value <= max);
  }

  static isValidArray(value: any, maxLength?: number): boolean {
    return Array.isArray(value) && (!maxLength || value.length <= maxLength);
  }

  static isValidObject(value: any, maxKeys?: number): boolean {
    return value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (maxKeys === undefined || Object.keys(value).length <= maxKeys);
  }
}

// =====================================================
// Message Schema Definitions
// =====================================================

const MessageSchemas: Record<string, any> = {
  // Chat messages
  'sendMessage': {
    required: ['message'],
    fields: {
      message: { type: 'string', maxLength: 100000 }, // 100KB max
      fileReferences: { type: 'array', maxLength: 50, optional: true }
    }
  },

  // File operations
  'openFile': {
    required: ['path'],
    fields: {
      path: { type: 'string', maxLength: 1000, sanitizer: 'filePath' }
    }
  },
  'searchFiles': {
    required: ['query'],
    fields: {
      query: { type: 'string', maxLength: 500 }
    }
  },
  'togglePinFile': {
    required: ['filePath'],
    fields: {
      filePath: { type: 'string', maxLength: 1000, sanitizer: 'filePath' }
    }
  },

  // Session management
  'switchSession': {
    required: ['sessionId'],
    fields: {
      sessionId: { type: 'string', maxLength: 100 }
    }
  },
  'sessionAction': {
    required: ['action', 'sessionId'],
    fields: {
      action: { type: 'string', maxLength: 50 },
      sessionId: { type: 'string', maxLength: 100 },
      payload: { type: 'object', maxKeys: 20, optional: true }
    }
  },
  'searchSessions': {
    required: ['query'],
    fields: {
      query: { type: 'string', maxLength: 100 }
    }
  },

  // Model and mode changes
  'modelChanged': {
    required: ['model'],
    fields: {
      model: { type: 'string', maxLength: 100 }
    }
  },
  'modeChanged': {
    required: ['modeId'],
    fields: {
      modeId: { type: 'string', maxLength: 50 }
    }
  },
  'setMode': {
    required: ['modeId'],
    fields: {
      modeId: { type: 'string', maxLength: 50 }
    }
  },
  'settingChanged': {
    required: ['key', 'value'],
    fields: {
      key: { type: 'string', minLength: 1 },
      value: { type: 'any' }
    }
  },
  'activityUpdate': {
    required: [],
    fields: {
      label: { type: 'string', optional: true, nullable: true }
    }
  },
  'setMaxTokens': {
    required: ['maxTokens'],
    fields: {
      maxTokens: { type: 'number', min: 1000, max: 2000000 }
    }
  },
  'fetchModels': {
    required: [],
    fields: {}
  },
  'toggleAgentMode': {
    required: ['enabled'],
    fields: {
      enabled: { type: 'boolean' }
    }
  },

  // Terminal operations
  'commandApprovalResponse': {
    required: ['commandId', 'approved'],
    fields: {
      commandId: { type: 'string', maxLength: 100 },
      approved: { type: 'boolean' }
    }
  },
  'killCommand': {
    required: ['commandId'],
    fields: {
      commandId: { type: 'string', maxLength: 100 }
    }
  },
  'setTerminalMode': {
    required: ['mode'],
    fields: {
      mode: { type: 'string', enum: ['manual', 'smart'] }
    }
  },

  // System operations
  'enhancePrompt': {
    required: ['prompt'],
    fields: {
      prompt: { type: 'string', maxLength: 10000 }
    }
  },
  'ready': {
    required: [],
    fields: {}
  },
  'clearHistory': {
    required: [],
    fields: {}
  },
  'requestContextUpdate': {
    required: [],
    fields: {}
  },
  'addFilesToContext': {
    required: [],
    fields: {}
  },
  'stopMessage': {
    required: [],
    fields: {}
  },
  'getWorkspaceInfo': {
    required: [],
    fields: {}
  },
  'getIndexingStats': {
    required: [],
    fields: {}
  },
  'refreshIndexing': {
    required: [],
    fields: {}
  },
  'addSourceFolder': {
    required: [],
    fields: {}
  },
  'openMemories': {
    required: [],
    fields: {}
  },
  'openFilePicker': {
    required: [],
    fields: {}
  },
  'requestFilePreview': {
    required: ['path'],
    fields: {
      path: { type: 'string', maxLength: 1000, sanitizer: 'filePath' }
    }
  },
  'revertCheckpoint': {
    required: ['checkpointId', 'messageId'],
    fields: {
      checkpointId: { type: 'string', maxLength: 100 },
      messageId: { type: 'string', maxLength: 100 }
    }
  },
  'systemMessageCreated': {
    required: ['messageId', 'content'],
    fields: {
      messageId: { type: 'string', maxLength: 100 },
      content: { type: 'string', maxLength: 10000 }
    }
  },
  'commandApprovalCreated': {
    required: ['message'],
    fields: {
      message: { type: 'object' }
    }
  },
  'commandApprovalUpdated': {
    required: ['message'],
    fields: {
      message: { type: 'object' }
    }
  },
  'toolExecutionCreated': {
    required: ['message'],
    fields: {
      message: { type: 'object' }
    }
  },
  'toolExecutionUpdated': {
    required: ['message'],
    fields: {
      message: { type: 'object' }
    }
  },
  'getSessions': {
    required: [],
    fields: {}
  },
  'newSession': {
    required: [],
    fields: {}
  },
  'refreshSessions': {
    required: [],
    fields: {}
  },
  'setApiKey': {
    required: ['key'],
    fields: {
      key: { type: 'string', maxLength: 1000 }
    }
  },
  'deleteApiKey': {
    required: [],
    fields: {}
  },
  'checkApiKey': {
    required: [],
    fields: {}
  },
  'toggleQuickPattern': {
    required: ['enabled'],
    fields: {
      patternId: { type: 'string', maxLength: 100, optional: true },
      name: { type: 'string', maxLength: 100, optional: true },
      enabled: { type: 'boolean' }
    }
  },
  'getValidationMetrics': {
    required: [],
    fields: {}
  },
  'refresh': {
    required: [],
    fields: {}
  },
  'analyzeWorkspace': {
    required: [],
    fields: {}
  },
  'openSettings': {
    required: [],
    fields: {}
  },
  'dismissAllIssues': {
    required: [],
    fields: {}
  },
  'navigateToFile': {
    required: ['path'],
    fields: {
      path: { type: 'string', maxLength: 1000, sanitizer: 'filePath' }
    }
  },
  'dismissIssue': {
    required: ['issueId'],
    fields: {
      issueId: { type: 'string', maxLength: 100 }
    }
  },
  'fixIssue': {
    required: ['issueId'],
    fields: {
      issueId: { type: 'string', maxLength: 100 }
    }
  },
  'addMemory': {
    required: ['content'],
    fields: {
      content: { type: 'string', maxLength: 10000 }
    }
  },
  'deleteMemory': {
    required: ['memoryId'],
    fields: {
      memoryId: { type: 'string', maxLength: 100 }
    }
  },

  // Planning and Task operations
  'syncTasks': {
    required: ['plans'],
    fields: {
      plans: { type: 'array', maxLength: 100 },
      currentPlanId: { type: 'string', maxLength: 100, optional: true, nullable: true }
    }
  },
  'syncContext': {
    required: ['files', 'stats'],
    fields: {
      files: { type: 'array', maxLength: 1000 },
      stats: { type: 'object', maxKeys: 20 }
    }
  },
  'requestCurrentPlan': {
    required: [],
    fields: {}
  },
  'retryStep': {
    required: ['planId', 'stepId'],
    fields: {
      planId: { type: 'string', maxLength: 100 },
      stepId: { type: 'string', maxLength: 100 }
    }
  },
  'skipStep': {
    required: ['planId', 'stepId'],
    fields: {
      planId: { type: 'string', maxLength: 100 },
      stepId: { type: 'string', maxLength: 100 }
    }
  },
  'requestSessionMetadata': {
    required: [],
    fields: {}
  },
  'abortPlan': {
    required: ['planId'],
    fields: {
      planId: { type: 'string', maxLength: 100 }
    }
  },
  'showStepResult': {
    required: ['planId', 'stepId', 'result'],
    fields: {
      planId: { type: 'string', maxLength: 100 },
      stepId: { type: 'string', maxLength: 100 },
      result: { type: 'object', maxKeys: 1000 }
    }
  },
  'getCheckpoints': {
    required: ['messageId'],
    fields: {
      messageId: { type: 'string', maxLength: 100 }
    }
  }
};

// =====================================================
// Main Message Validator Class
// =====================================================

export class MessageValidator {
  private readonly config: ValidationConfig;
  private readonly logger: SecurityLogger;
  private readonly rateLimiter: RateLimiter;
  private readonly sanitizer: InputSanitizer;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = {
      enableRateLimit: true,
      maxMessageSize: 1024 * 1024, // 1MB
      rateLimitWindow: 60000, // 1 minute
      maxMessagesPerWindow: 100,
      enableSanitization: true,
      enableSecurityLogging: true,
      ...config
    };

    this.logger = new SecurityLogger();
    this.rateLimiter = new RateLimiter(this.config);
    this.sanitizer = new InputSanitizer();
    console.log('--- MessageValidator (Schemas Loaded) v2 ---');
  }

  /**
   * Validates an inbound webview message
   */
  validateInboundMessage(data: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedData = data;

    try {
      // Log the validation attempt
      if (this.config.enableSecurityLogging) {
        this.logger.logSecurityEvent('Message validation started', {
          messageType: data?.type || 'unknown',
          messageSize: JSON.stringify(data).length
        });
      }

      // Basic type checking
      if (!TypeGuards.isWebviewMessage(data)) {
        errors.push({
          field: 'message',
          code: 'INVALID_TYPE',
          message: 'Message is not a valid webview message',
          severity: 'critical'
        });
        return { isValid: false, errors, warnings };
      }

      // Rate limiting check
      if (this.config.enableRateLimit && !this.rateLimiter.isAllowed()) {
        const timeUntilNext = this.rateLimiter.getTimeUntilNextMessage();
        errors.push({
          field: 'rateLimit',
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Please wait ${Math.ceil(timeUntilNext / 1000)} seconds.`,
          severity: 'error'
        });

        this.logger.logSecurityEvent('Rate limit exceeded', {
          timeUntilNext,
          messageCount: this.rateLimiter['messageTimestamps']?.length || 0
        }, 'error');

        return { isValid: false, errors, warnings };
      }

      // Message size check
      const messageSize = JSON.stringify(data).length;
      if (messageSize > this.config.maxMessageSize) {
        errors.push({
          field: 'message',
          code: 'MESSAGE_TOO_LARGE',
          message: `Message size (${messageSize} bytes) exceeds maximum allowed size (${this.config.maxMessageSize} bytes)`,
          severity: 'error'
        });
        return { isValid: false, errors, warnings };
      }

      // Message type validation
      if (!TypeGuards.isInboundMessage(data)) {
        errors.push({
          field: 'type',
          code: 'INVALID_MESSAGE_TYPE',
          message: `Message type '${data.type}' is not a valid inbound message type`,
          severity: 'critical'
        });
        return { isValid: false, errors, warnings };
      }

      // Schema validation
      const schema = MessageSchemas[data.type];
      if (schema) {
        const schemaValidation = this.validateAgainstSchema(data, schema);
        errors.push(...schemaValidation.errors);
        warnings.push(...schemaValidation.warnings);

        if (schemaValidation.sanitizedData) {
          sanitizedData = schemaValidation.sanitizedData;
        }
      } else {
        warnings.push({
          field: 'type',
          code: 'NO_SCHEMA_DEFINED',
          message: `No validation schema defined for message type '${data.type}'`
        });
      }

      const isValid = errors.length === 0;

      // Log validation result
      if (this.config.enableSecurityLogging) {
        this.logger.logSecurityEvent('Message validation completed', {
          messageType: data.type,
          isValid,
          errorCount: errors.length,
          warningCount: warnings.length
        }, isValid ? 'info' : 'warning');
      }

      return { isValid, errors, warnings, sanitizedData };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      errors.push({
        field: 'validation',
        code: 'VALIDATION_ERROR',
        message: `Validation failed: ${errorMessage}`,
        severity: 'critical'
      });

      this.logger.logSecurityEvent('Validation exception', {
        error: errorMessage,
        messageType: data?.type || 'unknown'
      }, 'error');

      return { isValid: false, errors, warnings };
    }
  }

  /**
   * Validates message against a schema
   */
  private validateAgainstSchema(data: any, schema: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedData = { ...data };

    // Check required fields
    for (const requiredField of schema.required || []) {
      if (!(requiredField in data) || data[requiredField] === undefined || data[requiredField] === null) {
        errors.push({
          field: requiredField,
          code: 'REQUIRED_FIELD_MISSING',
          message: `Required field '${requiredField}' is missing`,
          severity: 'error'
        });
      }
    }

    // Validate field types and constraints
    for (const [fieldName, fieldConfig] of Object.entries(schema.fields || {})) {
      const config = fieldConfig as any;
      const value = data[fieldName];

      // Skip validation for optional fields that are not present
      if (config.optional && (value === undefined || value === null)) {
        continue;
      }

      const fieldValidation = this.validateField(fieldName, value, config);
      errors.push(...fieldValidation.errors);
      warnings.push(...fieldValidation.warnings);

      // Update sanitized data if field was sanitized
      if (fieldValidation.sanitizedValue !== undefined) {
        sanitizedData[fieldName] = fieldValidation.sanitizedValue;
      }
    }

    return { isValid: errors.length === 0, errors, warnings, sanitizedData };
  }

  /**
   * Validates a single field
   */
  private validateField(fieldName: string, value: any, config: any): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    let sanitizedValue = value;

    // Type validation
    switch (config.type) {
      case 'string':
        if (!TypeGuards.isValidString(value, config.maxLength)) {
          errors.push({
            field: fieldName,
            code: 'INVALID_STRING',
            message: config.maxLength
              ? `Field '${fieldName}' must be a string with maximum length of ${config.maxLength} characters`
              : `Field '${fieldName}' must be a string`,
            severity: 'error'
          });
        } else if (config.minLength && value.length < config.minLength) {
          errors.push({
            field: fieldName,
            code: 'STRING_TOO_SHORT',
            message: `Field '${fieldName}' must be at least ${config.minLength} characters long`,
            severity: 'error'
          });
        } else if (this.config.enableSanitization && config.sanitizer) {
          sanitizedValue = this.applySanitizer(value, config.sanitizer);
          if (sanitizedValue !== value) {
            warnings.push({
              field: fieldName,
              code: 'FIELD_SANITIZED',
              message: `Field '${fieldName}' was sanitized for security reasons`
            });
          }
        }
        break;

      case 'boolean':
        if (!TypeGuards.isValidBoolean(value)) {
          errors.push({
            field: fieldName,
            code: 'INVALID_BOOLEAN',
            message: `Field '${fieldName}' must be a boolean`,
            severity: 'error'
          });
        }
        break;

      case 'number':
        if (!TypeGuards.isValidNumber(value, config.min, config.max)) {
          errors.push({
            field: fieldName,
            code: 'INVALID_NUMBER',
            message: config.min !== undefined && config.max !== undefined
              ? `Field '${fieldName}' must be a number between ${config.min} and ${config.max}`
              : `Field '${fieldName}' must be a valid number`,
            severity: 'error'
          });
        }
        break;

      case 'array':
        if (!TypeGuards.isValidArray(value, config.maxLength)) {
          errors.push({
            field: fieldName,
            code: 'INVALID_ARRAY',
            message: config.maxLength
              ? `Field '${fieldName}' must be an array with maximum length of ${config.maxLength} items`
              : `Field '${fieldName}' must be an array`,
            severity: 'error'
          });
        }
        break;

      case 'object':
        if (!TypeGuards.isValidObject(value, config.maxKeys)) {
          errors.push({
            field: fieldName,
            code: 'INVALID_OBJECT',
            message: config.maxKeys
              ? `Field '${fieldName}' must be an object with maximum ${config.maxKeys} keys`
              : `Field '${fieldName}' must be an object`,
            severity: 'error'
          });
        }
        break;
    }

    // Enum validation
    if (config.enum && Array.isArray(config.enum)) {
      if (!config.enum.includes(value)) {
        errors.push({
          field: fieldName,
          code: 'INVALID_ENUM_VALUE',
          message: `Field '${fieldName}' must be one of: ${config.enum.join(', ')}`,
          severity: 'error'
        });
      }
    }

    return { isValid: errors.length === 0, errors, warnings, sanitizedValue };
  }

  /**
   * Applies sanitizer to a value
   */
  private applySanitizer(value: string, sanitizerType: string): string {
    switch (sanitizerType) {
      case 'email':
        return this.sanitizer.sanitizeEmail(value);
      case 'filePath':
        return this.sanitizer.sanitizeFilePath(value);
      case 'json':
        return this.sanitizer.sanitizeJson(value);
      default:
        return this.sanitizer.sanitizeString(value);
    }
  }

  /**
   * Gets current rate limit status
   */
  getRateLimitStatus(): {
    isAllowed: boolean;
    messagesInWindow: number;
    timeUntilNextMessage: number;
  } {
    return {
      isAllowed: this.rateLimiter.isAllowed(),
      messagesInWindow: this.rateLimiter['messageTimestamps']?.length || 0,
      timeUntilNextMessage: this.rateLimiter.getTimeUntilNextMessage()
    };
  }

  /**
   * Resets rate limiter
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
  }

  /**
   * Shows security warnings to user
   */
  showValidationWarnings(warnings: ValidationWarning[]): void {
    if (warnings.length === 0) return;

    const warningMessages = warnings.map(w => w.message);
    this.logger.showToUser(
      `Security warnings: ${warningMessages.join('; ')}`,
      'warning'
    );
  }

  /**
   * Shows validation errors to user
   */
  showValidationErrors(errors: ValidationError[]): void {
    if (errors.length === 0) return;

    const criticalErrors = errors.filter(e => e.severity === 'critical');
    const regularErrors = errors.filter(e => e.severity === 'error');

    if (criticalErrors.length > 0) {
      this.logger.showToUser(
        `Critical security error: ${criticalErrors[0].message}`,
        'error'
      );
    } else if (regularErrors.length > 0) {
      this.logger.showToUser(
        `Validation error: ${regularErrors[0].message}`,
        'error'
      );
    }
  }
}