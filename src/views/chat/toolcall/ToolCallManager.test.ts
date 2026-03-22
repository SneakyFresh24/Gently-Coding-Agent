import { describe, expect, it } from 'vitest';
import { ToolCallManager } from './ToolCallManager';
import { ChatMessage } from '../../../services/OpenRouterService';

describe('ToolCallManager sequence repair', () => {
  const manager = new ToolCallManager({
    executeTool: async () => ({ ok: true })
  });

  it('removes orphaned tool results and adds placeholders for missing results', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }
        ]
      },
      {
        role: 'tool',
        content: '{"ok":true}',
        tool_call_id: 'orphan_call'
      }
    ];

    const repair = manager.repairConversationHistory(messages);

    expect(repair.repaired).toBe(true);
    expect(repair.fixes.some((fix) => fix.includes('Removed orphan tool_call_id=orphan_call'))).toBe(true);
    expect(repair.fixes.some((fix) => fix.includes('Added placeholder for call_1'))).toBe(true);
    expect(repair.issuesBefore.length).toBeGreaterThan(0);
    expect(repair.issuesAfter).toHaveLength(0);
  });

  it('produces stable repairHash for identical issue sets', () => {
    const first: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'list_files', arguments: '{}' } }]
      }
    ];
    const second: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'list_files', arguments: '{}' } }]
      }
    ];

    const firstRepair = manager.repairConversationHistory(first);
    const secondRepair = manager.repairConversationHistory(second);

    expect(firstRepair.repairHash).toBeDefined();
    expect(firstRepair.repairHash).toEqual(secondRepair.repairHash);
  });
});

