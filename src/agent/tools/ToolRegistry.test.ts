import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolRegistry } from './ToolRegistry';
import type { AgentTool } from '../agentManager/AgentManager';

describe('ToolRegistry', () => {
  let toolRegistry: ToolRegistry;
  let mockTool: AgentTool;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();

    mockTool = {
      name: 'test-tool',
      description: 'A test tool',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' }
        }
      },
      execute: vi.fn().mockResolvedValue({ success: true })
    };
  });

  describe('register', () => {
    it('should register a tool from definitions successfully', () => {
      // Use a real tool name from definitions for this test
      const executeFn = vi.fn();
      toolRegistry.register('read_file', executeFn);

      expect(toolRegistry.has('read_file')).toBe(true);
      const tool = toolRegistry.get('read_file');
      expect(tool?.name).toBe('read_file');
      expect(tool?.execute).toBe(executeFn);
    });

    it('should throw if tool definition is missing', () => {
      expect(() => {
        toolRegistry.register('non-existent' as any, vi.fn());
      }).toThrow();
    });
  });

  describe('registerMany', () => {
    it('should register multiple tools', () => {
      const mockTool2: AgentTool = {
        name: 'test-tool-2',
        description: 'Another test tool',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn()
      };

      toolRegistry.registerMany([mockTool, mockTool2]);

      expect(toolRegistry.has('test-tool')).toBe(true);
      expect(toolRegistry.has('test-tool-2')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return registered tool', () => {
      toolRegistry.registerMany([mockTool]);
      const tool = toolRegistry.get('test-tool');

      expect(tool).toEqual(mockTool);
    });

    it('should return undefined for non-existent tool', () => {
      const tool = toolRegistry.get('non-existent-tool');
      expect(tool).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      const mockTool2: AgentTool = {
        name: 'test-tool-2',
        description: 'Another test tool',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn()
      };

      toolRegistry.registerMany([mockTool, mockTool2]);
      const tools = toolRegistry.getAll();

      expect(tools).toHaveLength(2);
      expect(tools).toContainEqual(mockTool);
      expect(tools).toContainEqual(mockTool2);
    });

    it('should return empty array when no tools are registered', () => {
      const tools = toolRegistry.getAll();
      expect(tools).toEqual([]);
    });
  });

  describe('getNames', () => {
    it('should return all tool names', () => {
      const mockTool2: AgentTool = {
        name: 'test-tool-2',
        description: 'Another test tool',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn()
      };

      toolRegistry.registerMany([mockTool, mockTool2]);
      const names = toolRegistry.getNames();

      expect(names).toHaveLength(2);
      expect(names).toContain('test-tool');
      expect(names).toContain('test-tool-2');
    });
  });

  describe('has', () => {
    it('should return true for registered tool', () => {
      toolRegistry.registerMany([mockTool]);
      expect(toolRegistry.has('test-tool')).toBe(true);
    });

    it('should return false for non-existent tool', () => {
      expect(toolRegistry.has('non-existent-tool')).toBe(false);
    });
  });

  describe('getFormattedTools', () => {
    it('should format tools for API', () => {
      toolRegistry.registerMany([mockTool]);
      const tools = toolRegistry.getFormattedTools();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'test-tool',
          description: 'A test tool',
          parameters: mockTool.parameters
        }
      });
    });
  });

  describe('getToolsForPrompt', () => {
    it('should format tools for prompt', () => {
      toolRegistry.registerMany([mockTool]);
      const prompt = toolRegistry.getToolsForPrompt();

      expect(prompt).toContain('test-tool');
      expect(prompt).toContain('A test tool');
    });
  });

  describe('clear', () => {
    it('should clear all registered tools', () => {
      toolRegistry.registerMany([mockTool]);
      expect(toolRegistry.has('test-tool')).toBe(true);

      toolRegistry.clear();

      expect(toolRegistry.has('test-tool')).toBe(false);
      expect(toolRegistry.getAll()).toEqual([]);
    });
  });
});