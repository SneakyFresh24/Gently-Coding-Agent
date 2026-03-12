import { describe, it, expect } from 'vitest';
import {
  CONTEXT_LIMITS,
  TOOL_TIMEOUTS,
  FILE_LIMITS,
  MEMORY_LIMITS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  LOG_MESSAGES,
  MEMORY_CATEGORIES,
  EVENT_TYPES
} from './constants';

describe('Constants', () => {
  describe('CONTEXT_LIMITS', () => {
    it('should have default token limit', () => {
      expect(CONTEXT_LIMITS.DEFAULT_TOKEN_LIMIT).toBe(128000);
    });

    it('should have min and max token limits', () => {
      expect(CONTEXT_LIMITS.MIN_TOKEN_LIMIT).toBeGreaterThan(0);
      expect(CONTEXT_LIMITS.MAX_TOKEN_LIMIT).toBeGreaterThan(CONTEXT_LIMITS.DEFAULT_TOKEN_LIMIT);
    });
  });

  describe('FILE_LIMITS', () => {
    it('should have file size limits', () => {
      expect(FILE_LIMITS.MAX_FILE_SIZE).toBeGreaterThan(0);
      expect(FILE_LIMITS.MAX_PREVIEW_LINES).toBeGreaterThan(0);
      expect(FILE_LIMITS.MAX_SEARCH_RESULTS).toBeGreaterThan(0);
    });
  });

  describe('TOOL_TIMEOUTS', () => {
    it('should have default timeout', () => {
      expect(TOOL_TIMEOUTS.DEFAULT).toBeGreaterThan(0);
    });

    it('should have specific timeouts', () => {
      expect(TOOL_TIMEOUTS.LONG_RUNNING).toBeGreaterThan(TOOL_TIMEOUTS.DEFAULT);
      expect(TOOL_TIMEOUTS.QUICK).toBeLessThan(TOOL_TIMEOUTS.DEFAULT);
    });
  });

  describe('MEMORY_LIMITS', () => {
    it('should have memory limits', () => {
      expect(MEMORY_LIMITS.MAX_MEMORY_CONTENT_LENGTH).toBeGreaterThan(0);
      expect(MEMORY_LIMITS.MAX_RELEVANT_MEMORIES).toBeGreaterThan(0);
      expect(MEMORY_LIMITS.MIN_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('should have tool not found message', () => {
      const toolName = 'testTool';
      expect(ERROR_MESSAGES.TOOL_NOT_FOUND(toolName)).toContain(toolName);
    });

    it('should have file not found message', () => {
      const filePath = '/test/path';
      expect(ERROR_MESSAGES.FILE_NOT_FOUND(filePath)).toContain(filePath);
    });

    it('should have validation error message', () => {
      expect(ERROR_MESSAGES.VALIDATION_FAILED).toBe('Validation failed');
    });
  });

  describe('SUCCESS_MESSAGES', () => {
    it('should have file operation messages', () => {
      const filePath = '/test/file.txt';
      expect(SUCCESS_MESSAGES.FILE_CREATED(filePath)).toContain(filePath);
      expect(SUCCESS_MESSAGES.FILE_UPDATED(filePath)).toContain(filePath);
      expect(SUCCESS_MESSAGES.FILE_DELETED(filePath)).toContain(filePath);
    });

    it('should have command execution message', () => {
      const command = 'npm test';
      expect(SUCCESS_MESSAGES.COMMAND_EXECUTED(command)).toContain(command);
    });
  });

  describe('MEMORY_CATEGORIES', () => {
    it('should have all required categories', () => {
      expect(MEMORY_CATEGORIES.PREFERENCE).toBe('preference');
      expect(MEMORY_CATEGORIES.CODEBASE).toBe('codebase');
      expect(MEMORY_CATEGORIES.WORKFLOW).toBe('workflow');
      expect(MEMORY_CATEGORIES.TECH_STACK).toBe('tech-stack');
      expect(MEMORY_CATEGORIES.GENERAL).toBe('general');
    });
  });

  describe('EVENT_TYPES', () => {
    it('should have tool execution events', () => {
      expect(EVENT_TYPES.TOOL_EXECUTION_START).toBe('toolExecutionStart');
      expect(EVENT_TYPES.TOOL_EXECUTION_END).toBe('toolExecutionEnd');
    });

    it('should have context events', () => {
      expect(EVENT_TYPES.CONTEXT_UPDATED).toBe('contextUpdated');
    });

    it('should have plan events', () => {
      expect(EVENT_TYPES.PLAN_CREATED).toBe('planCreated');
      expect(EVENT_TYPES.PLAN_STATUS_UPDATE).toBe('planStatusUpdate');
    });
  });
});