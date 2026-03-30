import { describe, expect, it } from 'vitest';
import { ToolParamValidator } from './ToolParamValidator';

describe('ToolParamValidator', () => {
  const validator = new ToolParamValidator();

  it('accepts valid read_file payload', () => {
    const result = validator.validate('read_file', { path: 'src/index.ts' });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing required field', () => {
    const result = validator.validate('read_file', {});
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      code: 'VALIDATION_ERROR',
      tool: 'read_file',
      field: 'path'
    });
  });

  it('rejects unknown top-level field', () => {
    const result = validator.validate('read_file', { path: 'a.ts', extra: true });
    expect(result.valid).toBe(false);
    expect(result.errors.some((entry) => entry.message.includes('Unknown parameter'))).toBe(true);
  });

  it('sanitizes internal meta fields before validation', () => {
    const result = validator.validate('read_file', {
      path: 'src/index.ts',
      task_progress: 'done',
      planId: 'p1',
      stepId: 's1'
    });
    expect(result.valid).toBe(true);
  });

  it('validates anyOf schema for apply_block_edit', () => {
    const result = validator.validate('apply_block_edit', {
      file_path: 'src/app.ts',
      edits: [{
        old_content: 'a',
        new_content: 'b',
        reason: 'test'
      }]
    });
    expect(result.valid).toBe(true);
  });
});
