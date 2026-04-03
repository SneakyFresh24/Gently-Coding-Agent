// =====================================================
// Message Validator Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageValidator, TypeGuards } from './MessageValidator';
import * as vscode from 'vscode';

// Mock vscode module
const mockOutputChannel = {
  appendLine: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn()
};

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: () => mockOutputChannel,
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}));

describe('MessageValidator', () => {
  let validator: MessageValidator;

  beforeEach(() => {
    validator = new MessageValidator({
      enableRateLimit: true,
      maxMessageSize: 1024 * 512, // 512KB
      rateLimitWindow: 1000,
      maxMessagesPerWindow: 5,
      enableSanitization: true,
      enableSecurityLogging: true
    });
    
    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    validator.resetRateLimiter();
  });

  describe('Basic Validation', () => {
    it('should reject null/undefined messages', () => {
      const result1 = validator.validateInboundMessage(null);
      const result2 = validator.validateInboundMessage(undefined);

      expect(result1.isValid).toBe(false);
      expect(result2.isValid).toBe(false);
      expect(result1.errors).toContainEqual(
        expect.objectContaining({ code: 'INVALID_TYPE' })
      );
    });

    it('should reject messages without type', () => {
      const message = { data: 'test' };
      const result = validator.validateInboundMessage(message);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'INVALID_MESSAGE_TYPE' })
      );
    });

    it('should accept valid message structure', () => {
      const message = { type: 'ready' };
      const result = validator.validateInboundMessage(message);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should allow messages within rate limit', () => {
      const message = { type: 'ready' };
      
      for (let i = 0; i < 3; i++) {
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(true);
      }
    });

    it('should reject messages exceeding rate limit', () => {
      const message = { type: 'ready' };
      
      // Send messages up to the limit
      for (let i = 0; i < 5; i++) {
        validator.validateInboundMessage(message);
      }
      
      // Next message should be rejected
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' })
      );
    });

    it('should provide rate limit status', () => {
      const status = validator.getRateLimitStatus();
      
      expect(status).toHaveProperty('isAllowed');
      expect(status).toHaveProperty('messagesInWindow');
      expect(status).toHaveProperty('timeUntilNextMessage');
      expect(typeof status.isAllowed).toBe('boolean');
      expect(typeof status.messagesInWindow).toBe('number');
      expect(typeof status.timeUntilNextMessage).toBe('number');
    });
  });

  describe('Message Size Validation', () => {
    it('should reject messages exceeding size limit', () => {
      // Create a large message
      const largeData = 'x'.repeat(700000);
      const message = { 
        type: 'sendMessage', 
        message: largeData 
      };
      
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'MESSAGE_TOO_LARGE' })
      );
    });

    it('should accept messages within size limit', () => {
      const message = { 
        type: 'sendMessage', 
        message: 'Hello world' 
      };
      
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Schema Validation', () => {
    describe('Send Message', () => {
      it('should validate correct send message', () => {
        const message = {
          type: 'sendMessage',
          message: 'Hello, how are you?'
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(true);
      });

      it('should reject send message without text', () => {
        const message = {
          type: 'sendMessage'
          // missing message
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ 
            field: 'message',
            code: 'REQUIRED_FIELD_MISSING'
          })
        );
      });

      it('should reject send message with too long text', () => {
        const message = {
          type: 'sendMessage',
          message: 'x'.repeat(100001) // exceeds 100KB limit
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ 
            field: 'message',
            code: 'INVALID_STRING'
          })
        );
      });
    });

    describe('File Operations', () => {
      it('should validate correct open file message', () => {
        const message = {
          type: 'openFile',
          path: 'src/test.ts'
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(true);
      });

      it('should sanitize file paths', () => {
        const message = {
          type: 'openFile',
          path: '../../../etc/passwd'
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(true);
        expect(result.sanitizedData.path).toBe('etc/passwd');
        expect(result.warnings).toContainEqual(
          expect.objectContaining({ 
            field: 'path',
            code: 'FIELD_SANITIZED'
          })
        );
      });

      it('should reject open file without path', () => {
        const message = {
          type: 'openFile'
          // missing path
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ 
            field: 'path',
            code: 'REQUIRED_FIELD_MISSING'
          })
        );
      });
    });

    describe('Model Changes', () => {
      it('should validate correct model change', () => {
        const validModels = [
          'deepseek/deepseek-chat',
          'openai/gpt-4.1-mini',
          'anthropic/claude-3.7-sonnet'
        ];
        
        validModels.forEach(model => {
          const message = {
            type: 'modelChanged',
            model: model
          };
          
          const result = validator.validateInboundMessage(message);
          expect(result.isValid).toBe(true);
        });
      });

      it('should reject non-string model', () => {
        const message = {
          type: 'modelChanged',
          model: 123
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ 
            field: 'model',
            code: 'INVALID_STRING'
          })
        );
      });
    });

    describe('Terminal Operations', () => {
      it('should reject invalid terminal mode', () => {
        const message = {
          type: 'setTerminalMode',
          mode: 'invalid-mode'
        };
        
        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({ 
            field: 'mode',
            code: 'INVALID_ENUM_VALUE'
          })
        );
      });
    });

    describe('Question Response', () => {
      it('should validate a correct questionResponse payload', () => {
        const message = {
          type: 'questionResponse',
          questionId: 'question_123',
          selectedOptionIndexes: [0, 2],
          source: 'user'
        };

        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(true);
      });

      it('should reject questionResponse without questionId', () => {
        const message = {
          type: 'questionResponse',
          selectedOptionIndexes: [0]
        };

        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'questionId',
            code: 'REQUIRED_FIELD_MISSING'
          })
        );
      });

      it('should reject questionResponse with invalid source enum', () => {
        const message = {
          type: 'questionResponse',
          questionId: 'question_abc',
          selectedOptionIndexes: [0],
          source: 'timeout_default'
        };

        const result = validator.validateInboundMessage(message);
        expect(result.isValid).toBe(false);
        expect(result.errors).toContainEqual(
          expect.objectContaining({
            field: 'source',
            code: 'INVALID_ENUM_VALUE'
          })
        );
      });
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize string fields', () => {
      const message = {
        type: 'sendMessage',
        message: '  Hello with control chars \x00\x1F  '
      };
      
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(true);
      expect(result.sanitizedData.message).toBe('Hello with control chars ');
    });

    it('should handle JSON sanitization', () => {
      const message = {
        type: 'sessionAction',
        action: 'test',
        sessionId: 'session-123',
        payload: '{"malicious": "<script>alert(1)</script>"}'
      };
      
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(true);
      // JSON should be parsed and re-serialized safely
      expect(typeof result.sanitizedData.payload).toBe('object');
    });
  });

  describe('Unknown Message Types', () => {
    it('should handle unknown message types with warnings', () => {
      const message = {
        type: 'unknownMessageType',
        data: 'some data'
      };
      
      const result = validator.validateInboundMessage(message);
      expect(result.isValid).toBe(true); // Still valid, but with warning
      expect(result.warnings).toContainEqual(
        expect.objectContaining({ 
          field: 'type',
          code: 'NO_SCHEMA_DEFINED'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle validation exceptions gracefully', () => {
      // Create a message that might cause internal validation errors
      const circularMessage: any = {};
      circularMessage.self = circularMessage;
      
      const result = validator.validateInboundMessage(circularMessage);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ 
          field: 'validation',
          code: 'VALIDATION_ERROR'
        })
      );
    });
  });
});

describe('TypeGuards', () => {
  describe('isInboundMessage', () => {
    it('should identify valid inbound messages', () => {
      expect(TypeGuards.isInboundMessage({ type: 'setMode' })).toBe(true);
      expect(TypeGuards.isInboundMessage({ type: 'sendMessage' })).toBe(true);
      expect(TypeGuards.isInboundMessage({ type: 'ready' })).toBe(true);
    });

    it('should reject invalid inbound messages', () => {
      expect(TypeGuards.isInboundMessage(null)).toBe(false);
      expect(TypeGuards.isInboundMessage({})).toBe(false);
      expect(TypeGuards.isInboundMessage({ notype: 'test' })).toBe(false);
      expect(TypeGuards.isInboundMessage('string')).toBe(false);
    });
  });

  describe('isValidString', () => {
    it('should validate strings correctly', () => {
      expect(TypeGuards.isValidString('hello')).toBe(true);
      expect(TypeGuards.isValidString('')).toBe(true);
      expect(TypeGuards.isValidString('hello', 10)).toBe(true);
      expect(TypeGuards.isValidString('hello', 4)).toBe(false);
    });

    it('should reject non-strings', () => {
      expect(TypeGuards.isValidString(123)).toBe(false);
      expect(TypeGuards.isValidString(null)).toBe(false);
      expect(TypeGuards.isValidString(undefined)).toBe(false);
      expect(TypeGuards.isValidString({})).toBe(false);
    });
  });

  describe('isValidBoolean', () => {
    it('should validate booleans correctly', () => {
      expect(TypeGuards.isValidBoolean(true)).toBe(true);
      expect(TypeGuards.isValidBoolean(false)).toBe(true);
    });

    it('should reject non-booleans', () => {
      expect(TypeGuards.isValidBoolean('true')).toBe(false);
      expect(TypeGuards.isValidBoolean(1)).toBe(false);
      expect(TypeGuards.isValidBoolean(0)).toBe(false);
      expect(TypeGuards.isValidBoolean(null)).toBe(false);
    });
  });

  describe('isValidNumber', () => {
    it('should validate numbers correctly', () => {
      expect(TypeGuards.isValidNumber(123)).toBe(true);
      expect(TypeGuards.isValidNumber(0)).toBe(true);
      expect(TypeGuards.isValidNumber(-5)).toBe(true);
      expect(TypeGuards.isValidNumber(123, 100, 200)).toBe(true);
      expect(TypeGuards.isValidNumber(150, 100, 200)).toBe(true);
    });

    it('should reject non-numbers', () => {
      expect(TypeGuards.isValidNumber('123')).toBe(false);
      expect(TypeGuards.isValidNumber(NaN)).toBe(false);
      expect(TypeGuards.isValidNumber(null)).toBe(false);
      expect(TypeGuards.isValidNumber(undefined)).toBe(false);
    });
  });

  describe('isValidArray', () => {
    it('should validate arrays correctly', () => {
      expect(TypeGuards.isValidArray([])).toBe(true);
      expect(TypeGuards.isValidArray([1, 2, 3])).toBe(true);
      expect(TypeGuards.isValidArray([1, 2, 3], 5)).toBe(true);
      expect(TypeGuards.isValidArray([1, 2, 3], 2)).toBe(false);
    });

    it('should reject non-arrays', () => {
      expect(TypeGuards.isValidArray({})).toBe(false);
      expect(TypeGuards.isValidArray('array')).toBe(false);
      expect(TypeGuards.isValidArray(null)).toBe(false);
      expect(TypeGuards.isValidArray(undefined)).toBe(false);
    });
  });

  describe('isValidObject', () => {
    it('should validate objects correctly', () => {
      expect(TypeGuards.isValidObject({})).toBe(true);
      expect(TypeGuards.isValidObject({ a: 1, b: 2 })).toBe(true);
      expect(TypeGuards.isValidObject({ a: 1, b: 2 }, 3)).toBe(true);
      expect(TypeGuards.isValidObject({ a: 1, b: 2, c: 3 }, 2)).toBe(false);
    });

    it('should reject non-objects', () => {
      expect(TypeGuards.isValidObject([])).toBe(false);
      expect(TypeGuards.isValidObject('object')).toBe(false);
      expect(TypeGuards.isValidObject(null)).toBe(false);
      expect(TypeGuards.isValidObject(undefined)).toBe(false);
    });
  });
});
