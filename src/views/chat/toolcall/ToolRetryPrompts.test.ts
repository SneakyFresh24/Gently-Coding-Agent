import { describe, expect, it } from 'vitest';
import {
  buildMonolithRetryPrompt,
  buildOversizeRetryPrompt,
  buildProgressiveRetryPrompt,
  buildTruncatedRetryPrompt
} from './ToolRetryPrompts';

describe('ToolRetryPrompts', () => {
  it('builds level 1 retry prompt', () => {
    const prompt = buildProgressiveRetryPrompt({
      toolName: 'apply_block_edit',
      retryCount: 1,
      errorKind: 'edit_failure'
    });
    expect(prompt).toContain('Check your parameters and try again');
  });

  it('builds level 2 retry prompt with alternatives', () => {
    const prompt = buildProgressiveRetryPrompt({
      toolName: 'read_file',
      retryCount: 2,
      errorKind: 'read_failure'
    });
    expect(prompt).toContain('2nd failed attempt');
    expect(prompt).toContain('MUST use a different approach');
    expect(prompt).toContain('Verify path exists with list_files');
  });

  it('builds level 3+ retry prompt with stop instruction', () => {
    const prompt = buildProgressiveRetryPrompt({
      toolName: 'write_file',
      retryCount: 4,
      errorKind: 'oversize'
    });
    expect(prompt).toContain('CRITICAL: 3+ failures');
    expect(prompt).toContain('STOP retrying write_file');
    expect(prompt).toContain('report to user instead of retrying');
  });

  it('includes progressive guidance in truncated/oversize/monolith builders', () => {
    const truncated = buildTruncatedRetryPrompt({
      toolName: 'write_file',
      totalChars: 90000,
      retryCount: 2
    });
    const oversize = buildOversizeRetryPrompt({
      toolName: 'write_file',
      actualSize: 51000,
      retryCount: 3
    });
    const monolith = buildMonolithRetryPrompt({
      toolName: 'apply_block_edit',
      retryCount: 2
    });

    expect(truncated).toContain('2nd failed attempt');
    expect(oversize).toContain('CRITICAL: 3+ failures');
    expect(monolith).toContain('MUST use a different approach');
  });
});
