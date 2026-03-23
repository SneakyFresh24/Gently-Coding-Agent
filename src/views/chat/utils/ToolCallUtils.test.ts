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

  it('applies model-specific content fixes after JSON repair', () => {
    const calls = [
      {
        id: 'call_1',
        function: {
          name: 'apply_block_edit',
          arguments: JSON.stringify({
            patch: "```diff\n@@\n-&lt;div&gt;\\n+&lt;span&gt;\\n```"
          })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'deepseek/deepseek-chat' });
    expect(result.invalidToolCalls).toHaveLength(0);
    const parsed = JSON.parse(result.validToolCalls[0].function.arguments);
    expect(parsed.patch).toContain('<div>');
    expect(parsed.patch).toContain('<span>');
    expect(parsed.patch).not.toContain('```');
  });

  it('normalizes mistral tool ids to alphanumeric 9-char values', () => {
    const calls = [
      { id: 'tool-call-very-long-id', function: { name: 'read_file', arguments: '{}' } },
      { id: 'tool-call-very-long-id', function: { name: 'list_files', arguments: '{}' } }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'mistral/medium' });
    expect(result.invalidToolCalls).toHaveLength(0);
    const [first, second] = result.validToolCalls.map((c) => c.id);
    expect(first).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(second).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(first).not.toBe(second);
  });

  it('rejects oversized write_file content with standardized code', () => {
    const calls = [
      {
        id: 'call_oversize',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({
            path: 'src/huge.ts',
            content: 'a'.repeat(50_001)
          })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'openai/gpt-4.1' });
    expect(result.validToolCalls).toHaveLength(0);
    expect(result.invalidToolCalls).toHaveLength(1);
    expect(result.invalidToolCalls[0].code).toBe('TOOL_ARGS_TOO_LARGE');
  });

  it('marks truncated tool args with TOOL_ARGS_TRUNCATED code', () => {
    const calls = [
      {
        id: 'call_truncated',
        function: {
          name: 'write_file',
          arguments: '{"path":"src/a.ts","content":"line1\\nline2'
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'openai/gpt-4.1' });
    expect(result.validToolCalls).toHaveLength(0);
    expect(result.invalidToolCalls).toHaveLength(1);
    expect(result.invalidToolCalls[0].code).toBe('TOOL_ARGS_TRUNCATED');
  });
});
