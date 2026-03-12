// =====================================================
// Tool Call Validator Tests
// =====================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCallValidator } from '../ToolCallValidator';
import { ChatMessage } from '../../../../services/OpenRouterService';
import { ToolCallMessageContext } from '../types/ToolCallTypes';

describe('ToolCallValidator', () => {
  let validator: ToolCallValidator;

  beforeEach(() => {
    validator = new ToolCallValidator();
  });

  describe('validateToolCalls', () => {
    it('should validate valid tool calls', () => {
      const toolCalls = [
        {
          id: 'test-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [],
        messageId: 'msg-123',
        flowId: 'flow-123'
      };

      const result = validator.validateToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.toolCallGroups).toHaveLength(1);
      expect(result.toolCallGroups[0].toolCalls).toHaveLength(1);
      expect(result.toolCallGroups[0].toolCalls[0].id).toBe('test-1');
    });

    it('should reject tool calls with missing id', () => {
      const context: ToolCallMessageContext = {
        conversationHistory: [],
        messageId: 'msg-123'
      };

      const result = validator.validateToolCalls([
        {
          type: 'function',
          status: 'pending',
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ] as any, context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool call 0 missing id');
      expect(result.toolCallGroups).toHaveLength(0);
    });

    it('should reject tool calls with invalid type', () => {
      const context: ToolCallMessageContext = {
        conversationHistory: [],
        messageId: 'msg-123'
      };

      const result = validator.validateToolCalls([
        {
          id: 'test-1',
          type: 'invalid',
          status: 'pending',
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ] as any, context);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Tool call 0 has invalid type: invalid');
    });

    it('should reject tool calls with invalid JSON arguments', () => {
      const context: ToolCallMessageContext = {
        conversationHistory: [],
        messageId: 'msg-123'
      };

      const result = validator.validateToolCalls([
        {
          id: 'test-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"'  // Missing closing brace
          }
        }
      ] as any, context);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid JSON arguments'))).toBe(true);
    });

    it('should warn about empty tool calls array', () => {
      const toolCalls: any[] = [];

      const context: ToolCallMessageContext = {
        conversationHistory: [],
        messageId: 'msg-123'
      };

      const result = validator.validateToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Empty tool_calls array received');
    });
  });

  describe('validateMessageSequence', () => {
    it('should validate correct message sequence', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read the file',
          tool_calls: [
            [{ id: 'tc-1', type: 'function' as const, status: 'pending' as const, function: { name: 'read_file', arguments: '{}' } }] as any
          ]
        },
        { role: 'tool', content: 'File content', tool_call_id: 'tc-1' },
        { role: 'assistant', content: 'Here is the file content' }
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing tool messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read the file',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{}' } }
          ]
        },
        { role: 'assistant', content: 'Here is the file content' }  // Missing tool message
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('without corresponding tool messages'))).toBe(true);
    });

    it('should detect tool messages with missing tool_call_id', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'File content' }  // Missing tool_call_id
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('missing tool_call_id'))).toBe(true);
    });

    it('should detect tool messages with invalid tool_call_id', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read the file',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{}' } }
          ]
        },
        { role: 'tool', content: 'File content', tool_call_id: 'invalid-id' }  // Invalid tool_call_id
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('invalid tool_call_id'))).toBe(true);
    });

    it('should detect orphaned tool messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: 'File content', tool_call_id: 'tc-orphaned' }  // No preceding tool_calls
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Orphaned tool messages'))).toBe(true);
    });

    it('should handle multiple tool calls correctly', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read two files',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{"path": "file1.txt"}' } },
            { id: 'tc-2', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{"path": "file2.txt"}' } }
          ]
        },
        { role: 'tool', content: 'File 1 content', tool_call_id: 'tc-1' },
        { role: 'tool', content: 'File 2 content', tool_call_id: 'tc-2' },
        { role: 'assistant', content: 'Here are the file contents' }
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle out-of-order tool messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read two files',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{"path": "file1.txt"}' } },
            { id: 'tc-2', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{"path": "file2.txt"}' } }
          ]
        },
        { role: 'tool', content: 'File 2 content', tool_call_id: 'tc-2' },  // Out of order
        { role: 'tool', content: 'File 1 content', tool_call_id: 'tc-1' },  // Out of order
        { role: 'assistant', content: 'Here are the file contents' }
      ];

      const result = validator.validateMessageSequence(messages);

      expect(result.valid).toBe(true);  // Should still be valid as long as all tool messages exist
      expect(result.errors).toHaveLength(0);
    });
  });
});