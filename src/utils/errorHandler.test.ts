import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorHandler,
  AgentError,
  ToolError,
  FileError,
  MemoryError,
  ValidationError,
  NetworkError,
  handleErrors,
  safeExecute,
  retry
} from './errorHandler';

describe('ErrorHandler', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('handle', () => {
    it('should log error and return undefined', () => {
      const error = new Error('Test error');
      ErrorHandler.handle(error, 'test-operation');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[test-operation]'),
        expect.stringContaining('Test error')
      );
    });

    it('should handle AgentError with details', () => {
      const error = new AgentError('Test error', 'TEST_CODE', { detail: 'test' });
      ErrorHandler.handle(error, 'test-operation');
      
      const callArgs = consoleSpy.mock.calls[0];
      expect(callArgs[0]).toContain('[test-operation]');
      expect(callArgs[0]).toContain('AgentError: Test error');
      expect(callArgs[1]).toEqual({ detail: 'test' });
    });
  });

  describe('handleAndRethrow', () => {
    it('should log error and rethrow', () => {
      const error = new Error('Test error');
      
      expect(() => {
        ErrorHandler.handleAndRethrow(error, 'test-operation');
      }).toThrow('Test error');
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[test-operation]'),
        expect.stringContaining('Test error')
      );
    });
  });

  describe('createErrorResponse', () => {
    it('should create standardized error response', () => {
      const error = new AgentError('Test error', 'TEST_CODE', { detail: 'test' });
      const response = ErrorHandler.createErrorResponse(error, 'test-operation');
      
      expect(response).toEqual({
        success: false,
        error: 'Test error',
        code: 'TEST_CODE',
        details: { detail: 'test' }
      });
    });

    it('should handle generic errors', () => {
      const error = new Error('Test error');
      const response = ErrorHandler.createErrorResponse(error, 'test-operation');
      
      expect(response).toEqual({
        success: false,
        error: 'Test error',
        code: 'UNKNOWN_ERROR'
      });
    });
  });

  describe('wrapAsync', () => {
    it('should wrap successful async function', async () => {
      const fn = async () => 'success';
      const result = await ErrorHandler.wrapAsync(fn, 'test-operation');
      
      expect(result).toEqual({ success: true, data: 'success' });
    });

    it('should wrap failed async function', async () => {
      const fn = async () => { throw new Error('Test error'); };
      const result = await ErrorHandler.wrapAsync(fn, 'test-operation');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Test error');
      }
    });
  });

  describe('wrapSync', () => {
    it('should wrap successful sync function', () => {
      const fn = () => 'success';
      const result = ErrorHandler.wrapSync(fn, 'test-operation');
      
      expect(result).toEqual({ success: true, data: 'success' });
    });

    it('should wrap failed sync function', () => {
      const fn = () => { throw new Error('Test error'); };
      const result = ErrorHandler.wrapSync(fn, 'test-operation');
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Test error');
      }
    });
  });

  describe('isRecoverable', () => {
    it('should identify NetworkError as recoverable', () => {
      const error = new NetworkError('Test error');
      expect(ErrorHandler.isRecoverable(error)).toBe(true);
    });

    it('should identify ValidationError as non-recoverable', () => {
      const error = new ValidationError('Test error');
      expect(ErrorHandler.isRecoverable(error)).toBe(false);
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return message for AgentError', () => {
      const error = new AgentError('Test error', 'TEST_CODE');
      expect(ErrorHandler.getUserFriendlyMessage(error)).toBe('Test error');
    });

    it('should handle ENOENT errors', () => {
      const error = new Error('ENOENT: no such file');
      expect(ErrorHandler.getUserFriendlyMessage(error)).toContain('File not found');
    });
  });
});

describe('Custom Error Classes', () => {
  describe('AgentError', () => {
    it('should create AgentError with correct properties', () => {
      const error = new AgentError('Test message', 'TEST_CODE', { detail: 'test' });
      
      expect(error.name).toBe('AgentError');
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.details).toEqual({ detail: 'test' });
    });
  });

  describe('ToolError', () => {
    it('should create ToolError with correct properties', () => {
      const error = new ToolError('test-tool', 'Test message', { detail: 'test' });
      
      expect(error.name).toBe('ToolError');
      expect(error.message).toContain('Tool \'test-tool\' error');
      expect(error.code).toBe('TOOL_ERROR');
    });
  });

  describe('FileError', () => {
    it('should create FileError with correct properties', () => {
      const error = new FileError('/test/file.txt', 'Test message');
      
      expect(error.name).toBe('FileError');
      expect(error.message).toContain('File \'/test/file.txt\' error');
      expect(error.code).toBe('FILE_ERROR');
    });
  });
});

describe('Error Utilities', () => {
  describe('handleErrors decorator', () => {
    it('should decorate method with error handling', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      class TestClass {
        async testMethod(): Promise<string> {
          throw new Error('Test error');
        }
      }
      
      // Apply decorator manually for testing
      const originalMethod = TestClass.prototype.testMethod;
      TestClass.prototype.testMethod = handleErrors('test-context')(TestClass.prototype, 'testMethod', {
        value: originalMethod,
        writable: true,
        enumerable: true,
        configurable: true
      }).value;
      
      const instance = new TestClass();
      
      await expect(instance.testMethod()).rejects.toThrow('Test error');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[test-context]'),
        expect.stringContaining('Test error')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('safeExecute', () => {
    it('should execute function safely', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const fn = async () => { throw new Error('Test error'); };
      const result = await safeExecute(fn, 'fallback', 'test-context');
      
      expect(result).toBe('fallback');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[test-context]'),
        expect.stringContaining('Test error')
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('retry', () => {
    it('should retry recoverable errors', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new NetworkError('Test error');
        }
        return 'success';
      };
      
      const result = await retry(fn, 3, 10, 'test-context');
      
      expect(result).toBe('success');
      expect(attempts).toBe(2);
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});