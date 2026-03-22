import { describe, expect, it } from 'vitest';
import { ToolCallUtils } from './ToolCallUtils';

describe('ToolCallUtils.validateAndRepairToolCalls', () => {
  it('skips anonymous internal progress calls and emits model-scoped warning', () => {
    const calls = [
      {
        id: 'call_1',
        function: {
          name: '',
          arguments: JSON.stringify({ task_progress: 'working on patch' })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'minimax/minimax-m1' });

    expect(result.validToolCalls).toHaveLength(0);
    expect(result.invalidToolCalls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('internal_progress_skipped'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('model=minimax/minimax-m1'))).toBe(true);
  });

  it('renames duplicate IDs deterministically and emits warning', () => {
    const calls = [
      { id: 'dup', function: { name: 'read_file', arguments: '{}' } },
      { id: 'dup', function: { name: 'list_files', arguments: '{}' } },
      { id: 'dup', function: { name: 'get_context', arguments: '{}' } }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'minimax/minimax-m1' });

    expect(result.invalidToolCalls).toHaveLength(0);
    expect(result.validToolCalls.map((c) => c.id)).toEqual(['dup', 'dup_2', 'dup_3']);
    expect(result.warnings.filter((w) => w.includes('duplicate_tool_call_id_renamed')).length).toBe(2);
  });
});
