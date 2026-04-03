import { describe, expect, it, vi } from 'vitest';
import { ToolCallManager } from './ToolCallManager';
import { ChatMessage } from '../../../services/OpenRouterService';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback
    })
  }
}));

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

describe('ToolCallManager mode contract validation', () => {
  const manager = new ToolCallManager({
    executeTool: async () => ({ ok: true })
  });

  it('blocks mutating tools in architect (PLAN_STRICT)', async () => {
    const result = await manager.processToolCalls(
      [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'write_file', arguments: '{"path":"a.ts","content":"x"}' }
        } as any
      ],
      {
        selectedMode: 'architect',
        conversationHistory: []
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('MODE_TOOL_BLOCKED');
    expect(result.errors[0]).toContain('PLAN_STRICT');
  });

  it('blocks planning tools in code (ACT_STRICT)', async () => {
    const result = await manager.processToolCalls(
      [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'create_plan', arguments: '{"goal":"x","steps":[]}' }
        } as any
      ],
      {
        selectedMode: 'code',
        conversationHistory: []
      }
    );

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('MODE_TOOL_BLOCKED');
    expect(result.errors[0]).toContain('ACT_STRICT');
  });

  it('accepts plan/act aliases for mode contract validation', async () => {
    const planResult = await manager.processToolCalls(
      [
        {
          id: 'call_plan',
          type: 'function',
          function: { name: 'create_plan', arguments: '{"goal":"x","steps":[{"id":"1","title":"s"}]}' }
        } as any
      ],
      {
        selectedMode: 'plan',
        conversationHistory: []
      }
    );
    expect(planResult.valid).toBe(true);

    const actResult = await manager.processToolCalls(
      [
        {
          id: 'call_act',
          type: 'function',
          function: { name: 'create_plan', arguments: '{"goal":"x","steps":[]}' }
        } as any
      ],
      {
        selectedMode: 'act',
        conversationHistory: []
      }
    );
    expect(actResult.valid).toBe(false);
    expect(actResult.errors[0]).toContain('MODE_TOOL_BLOCKED');
    expect(actResult.errors[0]).toContain('ACT_STRICT');
  });
});
