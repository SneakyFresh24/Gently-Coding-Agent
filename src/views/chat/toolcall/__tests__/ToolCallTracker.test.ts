// =====================================================
// Tool Call Tracker Tests
// =====================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolCallTracker } from '../ToolCallTracker';
import { ToolCall, ToolCallEvent } from '../types/ToolCallTypes';

describe('ToolCallTracker', () => {
  let tracker: ToolCallTracker;

  beforeEach(() => {
    tracker = new ToolCallTracker();
  });

  describe('trackToolCall', () => {
    it('should track a new tool call', () => {
      const toolCall: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      const groupId = 'group-1';
      
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.trackToolCall(toolCall, groupId);

      const trackedCall = tracker.getToolCall('tc-1');
      expect(trackedCall).toBeDefined();
      expect(trackedCall?.id).toBe('tc-1');
      expect(trackedCall?.startTime).toBeDefined();

      const group = tracker.getToolGroup(groupId);
      expect(group).toBeDefined();
      expect(group?.toolCalls).toHaveLength(1);
      expect(group?.toolCalls[0].id).toBe('tc-1');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_calls_received',
          toolCallId: 'tc-1',
          groupId: 'group-1'
        })
      );
    });

    it('should add multiple tool calls to the same group', () => {
      const toolCall1: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      const toolCall2: ToolCall = {
        id: 'tc-2',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      };

      const groupId = 'group-1';

      tracker.trackToolCall(toolCall1, groupId);
      tracker.trackToolCall(toolCall2, groupId);

      const group = tracker.getToolGroup(groupId);
      expect(group?.toolCalls).toHaveLength(2);
    });

    it('should create a new group if it does not exist', () => {
      const toolCall: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      const groupId = 'new-group';
      tracker.trackToolCall(toolCall, groupId);

      const group = tracker.getToolGroup(groupId);
      expect(group).toBeDefined();
      expect(group?.id).toBe(groupId);
      expect(group?.status).toBe('pending');
    });
  });

  describe('updateToolCallStatus', () => {
    beforeEach(() => {
      const toolCall: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      tracker.trackToolCall(toolCall, 'group-1');
    });

    it('should update tool call status to executing', () => {
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.updateToolCallStatus('tc-1', 'executing');

      const toolCall = tracker.getToolCall('tc-1');
      expect(toolCall?.status).toBe('executing');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_call_started',
          toolCallId: 'tc-1'
        })
      );
    });

    it('should update tool call status to completed with result', () => {
      const result = { type: 'success' as const, data: { content: 'File content' } };
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.updateToolCallStatus('tc-1', 'completed', result);

      const toolCall = tracker.getToolCall('tc-1');
      expect(toolCall?.status).toBe('completed');
      expect(toolCall?.result).toEqual(result);
      expect(toolCall?.endTime).toBeDefined();
      expect(toolCall?.executionTime).toBeDefined();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_call_completed',
          toolCallId: 'tc-1',
          data: expect.objectContaining({ result })
        })
      );
    });

    it('should update tool call status to failed with error', () => {
      const error = 'File not found';
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.updateToolCallStatus('tc-1', 'failed', undefined, error);

      const toolCall = tracker.getToolCall('tc-1');
      expect(toolCall?.status).toBe('failed');
      expect(toolCall?.error).toBe(error);
      expect(toolCall?.endTime).toBeDefined();
      expect(toolCall?.executionTime).toBeDefined();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_call_failed',
          toolCallId: 'tc-1',
          data: expect.objectContaining({ error })
        })
      );
    });

    it('should handle unknown tool call gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      tracker.updateToolCallStatus('unknown-id', 'completed');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tool call not found: unknown-id')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('group status management', () => {
    beforeEach(() => {
      const toolCall1: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      const toolCall2: ToolCall = {
        id: 'tc-2',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      };

      tracker.trackToolCall(toolCall1, 'group-1');
      tracker.trackToolCall(toolCall2, 'group-1');
    });

    it('should update group status when all tools are completed', () => {
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.updateToolCallStatus('tc-1', 'completed', { type: 'success' as const, data: { result: 'File 1 content' } });
      tracker.updateToolCallStatus('tc-2', 'completed', { type: 'success' as const, data: { result: 'File 2 content' } });

      const group = tracker.getToolGroup('group-1');
      expect(group?.status).toBe('completed');
      expect(group?.completedAt).toBeDefined();
      expect(group?.totalExecutionTime).toBeDefined();

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_group_completed',
          groupId: 'group-1',
          data: expect.objectContaining({ success: true })
        })
      );
    });

    it('should update group status when any tool fails', () => {
      const eventSpy = vi.fn();
      tracker.addListener(eventSpy);

      tracker.updateToolCallStatus('tc-1', 'completed', { type: 'success' as const, data: { result: 'File 1 content' } });
      tracker.updateToolCallStatus('tc-2', 'failed', undefined, 'Write error');

      const group = tracker.getToolGroup('group-1');
      expect(group?.status).toBe('failed');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tool_group_completed',
          groupId: 'group-1',
          data: expect.objectContaining({ success: false })
        })
      );
    });

    it('should update group status to executing when any tool starts', () => {
      tracker.startGroupExecution('group-1');

      const group = tracker.getToolGroup('group-1');
      expect(group?.status).toBe('executing');
    });
  });

  describe('getActiveGroups', () => {
    it('should return only active groups', () => {
      // Create active group
      tracker.trackToolCall({
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      }, 'active-group');

      // Create completed group
      tracker.trackToolCall({
        id: 'tc-2',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      }, 'completed-group');

      tracker.updateToolCallStatus('tc-2', 'completed');

      const activeGroups = tracker.getActiveGroups();
      expect(activeGroups).toHaveLength(1);
      expect(activeGroups[0].id).toBe('active-group');
    });
  });

  describe('cleanupCompletedGroups', () => {
    beforeEach(() => {
      // Create old completed group
      tracker.trackToolCall({
        id: 'tc-old',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      }, 'old-group');

      tracker.updateToolCallStatus('tc-old', 'completed');

      // Simulate old completion time
      const group = tracker.getToolGroup('old-group');
      if (group) {
        (group as any).completedAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago
      }

      // Create recent completed group
      tracker.trackToolCall({
        id: 'tc-recent',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      }, 'recent-group');

      tracker.updateToolCallStatus('tc-recent', 'completed');
    });

    it('should cleanup old completed groups', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      tracker.cleanupCompletedGroups(5 * 60 * 1000); // 5 minutes max age

      expect(tracker.getToolGroup('old-group')).toBeUndefined();
      expect(tracker.getToolGroup('recent-group')).toBeDefined();
      expect(tracker.getToolCall('tc-old')).toBeUndefined();
      expect(tracker.getToolCall('tc-recent')).toBeDefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 1 completed groups')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('event listeners', () => {
    it('should add and remove listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      tracker.addListener(listener1);
      tracker.addListener(listener2);

      const toolCall: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      tracker.trackToolCall(toolCall, 'group-1');

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();

      tracker.removeListener(listener1);

      tracker.trackToolCall({
        id: 'tc-2',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      }, 'group-1');

      expect(listener1).toHaveBeenCalledTimes(1); // Still only called once
      expect(listener2).toHaveBeenCalledTimes(2); // Called twice
    });

    it('should handle listener errors gracefully', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const faultyListener = vi.fn(() => {
        throw new Error('Listener error');
      });

      tracker.addListener(faultyListener);

      const toolCall: ToolCall = {
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      };

      expect(() => {
        tracker.trackToolCall(toolCall, 'group-1');
      }).not.toThrow();

      expect(errorSpy).toHaveBeenCalledWith(
        '[ToolCallTracker] Error in event listener:',
        expect.any(Error)
      );

      errorSpy.mockRestore();
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', () => {
      // Create completed tool call
      tracker.trackToolCall({
        id: 'tc-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
        status: 'pending'
      }, 'group-1');

      tracker.updateToolCallStatus('tc-1', 'completed');

      // Create failed tool call
      tracker.trackToolCall({
        id: 'tc-2',
        type: 'function',
        function: { name: 'write_file', arguments: '{}' },
        status: 'pending'
      }, 'group-2');

      tracker.updateToolCallStatus('tc-2', 'failed');

      // Create active tool call
      tracker.trackToolCall({
        id: 'tc-3',
        type: 'function',
        function: { name: 'list_files', arguments: '{}' },
        status: 'executing'
      }, 'group-3');

      const stats = tracker.getStats();

      expect(stats.totalToolCalls).toBe(3);
      expect(stats.activeToolCalls).toBe(1);
      expect(stats.completedToolCalls).toBe(1);
      expect(stats.failedToolCalls).toBe(1);
      expect(stats.totalGroups).toBe(3);
      expect(stats.activeGroups).toBe(1);
    });
  });
});