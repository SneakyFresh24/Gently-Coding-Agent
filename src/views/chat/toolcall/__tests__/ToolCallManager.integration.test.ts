// =====================================================
// Tool Call Manager Integration Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToolCallManager } from '../ToolCallManager';
import { AgentManager } from '../../../../agent/agentManager/AgentManager';
import { ChatMessage } from '../../../../services/OpenRouterService';
import { ToolCallMessageContext } from '../types/ToolCallTypes';

// Mock AgentManager
const mockExecuteTool = vi.fn();
const mockAgentManager = {
  executeTool: mockExecuteTool,
  getFormattedTools: vi.fn(() => []),
  getAvailableTools: vi.fn(() => [])
} as unknown as AgentManager;

describe('ToolCallManager Integration Tests', () => {
  let toolCallManager: ToolCallManager;

  beforeEach(() => {
    vi.clearAllMocks();
    toolCallManager = new ToolCallManager(mockAgentManager, {
      enableValidation: true,
      enableMigration: false,
      maxConcurrentToolCalls: 2,
      toolExecutionTimeout: 5000,
      enableDetailedLogging: false
    });
  });

  afterEach(() => {
    toolCallManager.dispose();
  });

  describe('Complete Tool Call Flow', () => {
    it('should process tool calls from start to finish', async () => {
      // Mock successful tool execution
      mockExecuteTool.mockResolvedValue({ content: 'File content' });

      const toolCalls = [
        {
          id: 'tc-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        },
        {
          id: 'tc-2',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'write_file',
            arguments: '{"path": "output.txt", "content": "Hello World"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [
          { role: 'user', content: 'Please read and write files' }
        ],
        messageId: 'msg-123',
        flowId: 'flow-123'
      };

      const result = await toolCallManager.processToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.toolCallGroups).toHaveLength(1);
      expect(result.toolCallGroups[0].toolCalls).toHaveLength(2);

      // Verify tools were executed
      expect(mockExecuteTool).toHaveBeenCalledWith('read_file', { path: 'test.txt' });
      expect(mockExecuteTool).toHaveBeenCalledWith('write_file', {
        path: 'output.txt',
        content: 'Hello World'
      });

      // Wait for async execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check conversation messages
      const toolMessages = toolCallManager.createConversationMessages(['tc-1', 'tc-2']);
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages[0].role).toBe('tool');
      expect(toolMessages[0].tool_call_id).toBe('tc-1');
      expect(toolMessages[1].role).toBe('tool');
      expect(toolMessages[1].tool_call_id).toBe('tc-2');
    });

    it('should handle tool execution failures gracefully', async () => {
      // Mock tool execution failure
      mockExecuteTool.mockRejectedValue(new Error('File not found'));

      const toolCalls = [
        {
          id: 'tc-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "nonexistent.txt"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [
          { role: 'user', content: 'Read a file' }
        ],
        messageId: 'msg-123'
      };

      const result = await toolCallManager.processToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.toolCallGroups).toHaveLength(1);

      // Wait for async execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that tool call is marked as failed
      const stats = toolCallManager.getStats();
      expect(stats.failedToolCalls).toBe(1);
    });

    it('should respect concurrent execution limits', async () => {
      // Mock slow tool execution
      let executionCount = 0;
      mockExecuteTool.mockImplementation(async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return { content: `Result ${executionCount}` };
      });

      const toolCalls = Array.from({ length: 4 }, (_, i) => ({
        id: `tc-${i + 1}`,
        type: 'function' as const,
        status: 'pending' as const,
        function: {
          name: 'read_file',
          arguments: `{"path": "file${i + 1}.txt"}`
        }
      }));

      const context: ToolCallMessageContext = {
        conversationHistory: [{ role: 'user', content: 'Read multiple files' }],
        messageId: 'msg-123'
      };

      const startTime = Date.now();
      const result = await toolCallManager.processToolCalls(toolCalls, context);
      const endTime = Date.now();

      expect(result.valid).toBe(true);

      // Should take approximately 200ms (2 batches of 100ms each) due to concurrency limit of 2
      expect(endTime - startTime).toBeGreaterThan(180);
      expect(endTime - startTime).toBeLessThan(300);

      expect(mockExecuteTool).toHaveBeenCalledTimes(4);
    });
  });

  describe('Conversation History Validation', () => {
    it('should validate correct conversation history', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read the file',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{}' } }
          ]
        },
        { role: 'tool', content: 'File content', tool_call_id: 'tc-1' },
        { role: 'assistant', content: 'Here is the file content' }
      ];

      const result = toolCallManager.validateConversationHistory(messages);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect conversation history issues', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: 'I will read the file',
          tool_calls: [
            { id: 'tc-1', type: 'function', status: 'pending', function: { name: 'read_file', arguments: '{}' } }
          ]
        },
        { role: 'assistant', content: 'Missing tool message' }  // No tool message
      ];

      const result = toolCallManager.validateConversationHistory(messages);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Event Handling', () => {
    it('should emit events during tool execution', async () => {
      const eventSpy = {
        onToolCallEvent: vi.fn()
      };
      toolCallManager.addListener(eventSpy);

      mockExecuteTool.mockResolvedValue({ content: 'Success' });

      const toolCalls = [
        {
          id: 'tc-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [{ role: 'user', content: 'Read file' }],
        messageId: 'msg-123'
      };

      await toolCallManager.processToolCalls(toolCalls, context);

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(eventSpy.onToolCallEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_calls_received'
        })
      );

      expect(eventSpy.onToolCallEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_call_started'
        })
      );

      expect(eventSpy.onToolCallEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_call_completed'
        })
      );

      expect(eventSpy.onToolCallEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_group_completed'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors', async () => {
      const invalidToolCalls = [
        {
          // Missing id
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        } as any
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [{ role: 'user', content: 'Read file' }],
        messageId: 'msg-123'
      };

      const result = await toolCallManager.processToolCalls(invalidToolCalls, context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.toolCallGroups).toHaveLength(0);
    });

    it('should handle tool execution timeouts', async () => {
      // Mock slow tool execution that exceeds timeout
      mockExecuteTool.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 8000)); // 8 seconds (longer than 5s timeout)
        return { content: 'Success' };
      });

      const toolCalls = [
        {
          id: 'tc-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [{ role: 'user', content: 'Read file' }],
        messageId: 'msg-123'
      };

      const result = await toolCallManager.processToolCalls(toolCalls, context);

      expect(result.valid).toBe(true); // Validation passes

      // Wait for timeout to occur and be handled
      await new Promise(resolve => setTimeout(resolve, 6000)); // Wait longer than the 5s timeout

      const stats = toolCallManager.getStats();
      expect(stats.failedToolCalls).toBe(1);
    }, 15000); // Increase test timeout to 15 seconds
  });

  describe('Migration Mode', () => {
    it('should work with validation disabled', async () => {
      const migrationManager = new ToolCallManager(mockAgentManager, {
        enableValidation: false,
        enableMigration: true
      });

      mockExecuteTool.mockResolvedValue({ content: 'Success' });

      const toolCalls = [
        {
          id: 'tc-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: '{"path": "test.txt"}'
          }
        }
      ];

      const context: ToolCallMessageContext = {
        conversationHistory: [{ role: 'user', content: 'Read file' }],
        messageId: 'msg-123'
      };

      const result = await migrationManager.processToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Validation disabled - running in migration mode');

      migrationManager.dispose();
    });
  });
});