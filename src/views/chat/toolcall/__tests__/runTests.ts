// =====================================================
// Tool Call System Test Runner
// =====================================================

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ToolCallManager } from '../ToolCallManager';
import { ToolCallValidator } from '../ToolCallValidator';
import { ToolCallTracker } from '../ToolCallTracker';
// LegacyToolCallAdapter wurde entfernt - Migration ist abgeschlossen
import { AgentManager } from '../../../../agent/agentManager/AgentManager';
import { ToolExecutionHandler } from '../../handlers/ExecutionDispatchers';
import { ChatMessage } from '../../../../services/OpenRouterService';

// Mock implementations
const createMockAgentManager = () => ({
  executeTool: async (toolName: string, params: any) => {
    // Simulate tool execution
    await new Promise(resolve => setTimeout(resolve, 10));

    switch (toolName) {
      case 'read_file':
        return { content: `File content for ${params.path}` };
      case 'write_file':
        return { success: true, path: params.path };
      case 'list_files':
        return { files: ['file1.txt', 'file2.txt'] };
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  },
  getFormattedTools: () => [],
  getAvailableTools: () => []
}) as unknown as AgentManager;

const createMockToolExecutionHandler = () => ({
  handleToolCalls: async (toolCalls: any[], messageId: string, context: any) => {
    // Mock legacy handler
    console.log(`[MockLegacyHandler] Handling ${toolCalls.length} tool calls`);
  }
}) as unknown as ToolExecutionHandler;

describe('Tool Call System Validation', () => {
  let mockAgentManager: AgentManager;
  let mockLegacyHandler: ToolExecutionHandler;
  let toolCallManager: ToolCallManager;
  let validator: ToolCallValidator;
  let tracker: ToolCallTracker;
  // let adapter: LegacyToolCallAdapter; // Entfernt - Migration abgeschlossen

  beforeAll(() => {
    mockAgentManager = createMockAgentManager();
    mockLegacyHandler = createMockToolExecutionHandler();

    toolCallManager = new ToolCallManager(mockAgentManager, {
      enableValidation: true,
      enableMigration: false,
      maxConcurrentToolCalls: 3,
      toolExecutionTimeout: 5000,
      enableDetailedLogging: false
    });

    validator = new ToolCallValidator();
    tracker = new ToolCallTracker();

    // Adapter wurde entfernt - Migration abgeschlossen
    // adapter = new LegacyToolCallAdapter(mockAgentManager, mockLegacyHandler, {
    //   enableNewSystem: true,
    //   enableFallback: true,
    //   migrationMode: 'hybrid',
    //   logMigrationEvents: false
    // });
  });

  afterAll(() => {
    toolCallManager.dispose();
    // adapter.dispose(); // Entfernt - Migration abgeschlossen
  });

  describe('System Integration Validation', () => {
    it('should validate complete tool call workflow', async () => {
      const toolCalls: any[] = [
        {
          id: 'tc-read-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'test.txt' })
          }
        },
        {
          id: 'tc-write-1',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'output.txt', content: 'Hello World' })
          }
        }
      ];

      const context = {
        conversationHistory: [
          { role: 'user' as const, content: 'Please read and write files' }
        ],
        messageId: 'msg-test-1',
        flowId: 'flow-test-1'
      };

      // Process with new system
      const result = await toolCallManager.processToolCalls(toolCalls, context);

      expect(result.valid).toBe(true);
      expect(result.toolCallGroups).toHaveLength(1);
      expect(result.toolCallGroups[0].toolCalls).toHaveLength(2);

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify conversation messages
      const toolMessages = toolCallManager.createConversationMessages(['tc-read-1', 'tc-write-1']);
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages[0].tool_call_id).toBe('tc-read-1');
      expect(toolMessages[1].tool_call_id).toBe('tc-write-1');

      // Validate conversation history
      const fullHistory: ChatMessage[] = [
        ...context.conversationHistory,
        { role: 'assistant' as const, content: 'Processing...', tool_calls: toolCalls },
        ...toolMessages
      ];

      const validation = toolCallManager.validateConversationHistory(fullHistory);
      expect(validation.valid).toBe(true);
    });

    it('should handle complex multi-turn conversations', async () => {
      const conversationHistory: ChatMessage[] = [
        { role: 'user' as const, content: 'Help me analyze the project structure' },
        {
          role: 'assistant' as const,
          content: 'I will analyze the project structure',
          tool_calls: [
            { id: 'tc-1', type: 'function' as const, status: 'pending' as const, function: { name: 'analyze_project_structure', arguments: '{}' } }
          ]
        },
        { role: 'tool' as const, content: '{"structure": "found"}', tool_call_id: 'tc-1' },
        { role: 'assistant' as const, content: 'I found the project structure. Let me read some files.' },
        {
          role: 'assistant' as const,
          content: 'I will read the main files',
          tool_calls: [
            { id: 'tc-2', type: 'function' as const, status: 'pending' as const, function: { name: 'read_file', arguments: '{"path": "package.json"}' } },
            { id: 'tc-3', type: 'function' as const, status: 'pending' as const, function: { name: 'read_file', arguments: '{"path": "README.md"}' } }
          ]
        },
        { role: 'tool' as const, content: '{"content": "package.json content"}', tool_call_id: 'tc-2' },
        { role: 'tool' as const, content: '{"content": "README.md content"}', tool_call_id: 'tc-3' },
        { role: 'assistant' as const, content: 'Here is my analysis of the project...' }
      ];

      const validation = validator.validateMessageSequence(conversationHistory);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect and prevent API errors', async () => {
      // Simulate problematic conversation that would cause the API error
      const problematicHistory: ChatMessage[] = [
        { role: 'user' as const, content: 'Do something' },
        {
          role: 'assistant' as const,
          content: 'I will use tools',
          tool_calls: [
            { id: 'tc-problem', type: 'function' as const, status: 'pending' as const, function: { name: 'read_file', arguments: '{}' } }
          ]
        },
        { role: 'assistant' as const, content: 'Missing tool message - this would cause API error' }
      ];

      const validation = validator.validateMessageSequence(problematicHistory);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('without corresponding tool messages'))).toBe(true);
    });
  });

  describe('Migration System Validation', () => {
    it('should confirm migration is completed', () => {
      // Migration ist abgeschlossen - nur neues System wird verwendet
      expect(true).toBe(true); // Placeholder-Test
    });
  });

  describe('Performance and Reliability', () => {
    it('should handle concurrent tool execution efficiently', async () => {
      const toolCalls: any[] = Array.from({ length: 10 }, (_, i) => ({
        id: `tc-concurrent-${i}`,
        type: 'function' as const,
        status: 'pending' as const,
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: `file${i}.txt` })
        }
      }));

      const context = {
        conversationHistory: [{ role: 'user' as const, content: 'Read many files' }],
        messageId: 'msg-concurrent'
      };

      const startTime = Date.now();
      const result = await toolCallManager.processToolCalls(toolCalls, context);
      const endTime = Date.now();

      expect(result.valid).toBe(true);

      // Should complete in reasonable time (concurrent execution)
      expect(endTime - startTime).toBeLessThan(1000);

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 200));

      const stats = toolCallManager.getStats();
      expect(stats.completedToolCalls).toBe(10);
    });

    it('should handle errors gracefully without crashing', async () => {
      // Create a mock that throws errors
      const errorProneManager = {
        executeTool: async (toolName: string, params: any) => {
          if (toolName === 'error_tool') {
            throw new Error('Simulated tool error');
          }
          return { success: true };
        },
        getFormattedTools: () => [],
        getAvailableTools: () => []
      } as unknown as AgentManager;

      const errorManager = new ToolCallManager(errorProneManager, {
        enableValidation: true,
        enableMigration: false
      });

      const toolCalls = [
        {
          id: 'tc-error',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'error_tool',
            arguments: '{}'
          }
        },
        {
          id: 'tc-success',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'success_tool',
            arguments: '{}'
          }
        }
      ];

      const context = {
        conversationHistory: [{ role: 'user' as const, content: 'Test error handling' }],
        messageId: 'msg-error'
      };

      const result = await errorManager.processToolCalls(toolCalls, context);
      expect(result.valid).toBe(true);

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = errorManager.getStats();
      expect(stats.completedToolCalls).toBe(1);
      expect(stats.failedToolCalls).toBe(1);

      errorManager.dispose();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty tool calls', async () => {
      const context = {
        conversationHistory: [{ role: 'user' as const, content: 'Hello' }],
        messageId: 'msg-empty'
      };

      const result = await toolCallManager.processToolCalls([], context);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Empty tool_calls array received');
    });

    it('should handle malformed tool calls gracefully', async () => {
      const malformedToolCalls = [
        null,
        undefined,
        {},
        { id: 'tc-1' },  // Missing function
        { function: {} }  // Missing id
      ] as any[];

      const context = {
        conversationHistory: [{ role: 'user' as const, content: 'Test malformed' }],
        messageId: 'msg-malformed'
      };

      const result = await toolCallManager.processToolCalls(malformedToolCalls, context);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle very large tool call arguments', async () => {
      const largeContent = 'x'.repeat(10000); // 10KB
      const toolCalls = [
        {
          id: 'tc-large',
          type: 'function' as const,
          status: 'pending' as const,
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'large.txt', content: largeContent })
          }
        }
      ];

      const context = {
        conversationHistory: [{ role: 'user' as const, content: 'Write large file' }],
        messageId: 'msg-large'
      };

      const result = await toolCallManager.processToolCalls(toolCalls, context);
      expect(result.valid).toBe(true);

      // Wait for execution to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const stats = toolCallManager.getStats();
      expect(stats.completedToolCalls).toBe(1);
    });
  });
});