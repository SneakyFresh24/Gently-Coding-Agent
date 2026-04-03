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

  it('normalizes claude tool ids with disallowed characters and keeps uniqueness', () => {
    const calls = [
      { id: 'tool_üñïçödé_123', function: { name: 'read_file', arguments: '{}' } },
      { id: 'tool_üñïçödé_123', function: { name: 'list_files', arguments: '{}' } }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, { model: 'anthropic/claude-4.1-sonnet' });
    expect(result.invalidToolCalls).toHaveLength(0);
    expect(result.validToolCalls[0].id).toBe('tool______d__123');
    expect(result.validToolCalls[1].id).toBe('tool______d__123_2');
    expect(result.warnings.some((w) => w.includes('claude_tool_call_id_normalized'))).toBe(true);
  });

  it('auto-chunks oversized write_file content into write_file_chunk calls', () => {
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
    expect(result.invalidToolCalls).toHaveLength(0);
    expect(result.validToolCalls.length).toBeGreaterThan(1);
    expect(result.validToolCalls.every((call) => call.function.name === 'write_file_chunk')).toBe(true);

    const firstArgs = JSON.parse(result.validToolCalls[0].function.arguments);
    const lastArgs = JSON.parse(result.validToolCalls[result.validToolCalls.length - 1].function.arguments);
    expect(firstArgs.path).toBe('src/huge.ts');
    expect(firstArgs.chunkIndex).toBe(0);
    expect(firstArgs.chunkCount).toBe(result.validToolCalls.length);
    expect(typeof firstArgs.writeSessionId).toBe('string');
    expect(lastArgs.chunkIndex).toBe(result.validToolCalls.length - 1);
    expect(lastArgs.chunkCount).toBe(result.validToolCalls.length);
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

  it('warns on large inline html blocks when monolithPolicy=warn', () => {
    const calls = [
      {
        id: 'call_warn_inline',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({
            path: 'src/index.html',
            content: `<html><head><style>${Array.from({ length: 30 }, (_, i) => `.c${i}{color:red;}`).join('\n')}</style></head><body></body></html>`
          })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, {
      model: 'openai/gpt-4.1',
      guardrailPolicy: { monolithPolicy: 'warn', maxInlineLines: 20 }
    });

    expect(result.validToolCalls).toHaveLength(1);
    expect(result.invalidToolCalls).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes('Detected large inline blocks'))).toBe(true);
  });

  it('blocks large inline html blocks when monolithPolicy=block', () => {
    const calls = [
      {
        id: 'call_block_inline',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({
            path: 'src/index.html',
            content: `<html><head><script>${Array.from({ length: 40 }, (_, i) => `console.log(${i});`).join('\n')}</script></head><body></body></html>`
          })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, {
      model: 'openai/gpt-4.1',
      guardrailPolicy: { monolithPolicy: 'block', maxInlineLines: 20 }
    });

    expect(result.validToolCalls).toHaveLength(0);
    expect(result.invalidToolCalls).toHaveLength(1);
    expect(result.invalidToolCalls[0].code).toBe('TOOL_MONOLITH_POLICY_VIOLATION');
  });

  it('emits growth warning for large python files', () => {
    const calls = [
      {
        id: 'call_growth_warn',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({
            path: 'src/main.py',
            content: Array.from({ length: 520 }, (_, i) => `line_${i} = ${i}`).join('\n')
          })
        }
      }
    ];

    const result = ToolCallUtils.validateAndRepairToolCalls(calls, {
      model: 'openai/gpt-4.1',
      guardrailPolicy: { growthLineThreshold: 500 }
    });

    expect(result.validToolCalls).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes('Consider modularizing'))).toBe(true);
  });
});

describe('ToolCallUtils path + messaging helpers', () => {
  it('extracts nested file paths from apply_block_edit v2 payloads', () => {
    const filePaths = ToolCallUtils.extractFilePathsFromToolCalls([
      {
        function: {
          name: 'apply_block_edit',
          arguments: JSON.stringify({
            file_edits: [
              { file_path: 'src/a.ts', edits: [{ old_content: 'a', new_content: 'b', reason: 'x' }] },
              { file_path: 'src/b.ts', edits: [{ old_content: 'c', new_content: 'd', reason: 'y' }] }
            ]
          })
        }
      }
    ]);

    expect(filePaths.has('src/a.ts')).toBe(true);
    expect(filePaths.has('src/b.ts')).toBe(true);
  });

  it('returns multi-file thinking message for apply_block_edit v2 payloads', () => {
    const message = ToolCallUtils.getThinkingMessage('apply_block_edit', {
      file_edits: [{ file_path: 'src/a.ts' }, { file_path: 'src/b.ts' }]
    });
    expect(message).toContain('2 files');
  });
});
