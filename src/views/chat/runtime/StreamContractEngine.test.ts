import { describe, expect, it } from 'vitest';
import {
  StreamContractEngine,
  StreamContractViolationError
} from './StreamContractEngine';

describe('StreamContractEngine', () => {
  const engine = new StreamContractEngine();

  it('accepts terminated stream contract input', () => {
    expect(() =>
      engine.assertTerminated({
        streamTerminated: true,
        stoppedByUser: false,
        assistantMessage: 'ok',
        toolCalls: [],
        incompleteToolCalls: []
      })
    ).not.toThrow();
  });

  it('accepts user-stopped streams without requiring message_stop', () => {
    expect(() =>
      engine.assertTerminated({
        streamTerminated: false,
        stoppedByUser: true,
        assistantMessage: '',
        toolCalls: [],
        incompleteToolCalls: []
      })
    ).not.toThrow();
  });

  it('throws explicit error when stream stop marker is missing', () => {
    expect(() =>
      engine.assertTerminated({
        streamTerminated: false,
        stoppedByUser: false,
        assistantMessage: 'partial',
        toolCalls: [],
        incompleteToolCalls: []
      })
    ).toThrow(StreamContractViolationError);
  });

  it('classifies strict empty responses correctly', () => {
    const input = {
      streamTerminated: true,
      stoppedByUser: false,
      assistantMessage: '   ',
      toolCalls: [],
      incompleteToolCalls: []
    };
    expect(engine.isStrictlyEmptyAssistantResponse(input)).toBe(true);
    expect(() => engine.assertNotStrictlyEmpty(input)).toThrow(StreamContractViolationError);
  });

  it('does not classify incomplete tool call as empty response', () => {
    const input = {
      streamTerminated: true,
      stoppedByUser: false,
      assistantMessage: '',
      toolCalls: [],
      incompleteToolCalls: [
        {
          id: 'tool-1',
          name: 'write_file',
          rawArguments: '{',
          rawArgumentsPreview: '{',
          truncationReason: 'stream_ended_mid_json' as const,
          recoveredFields: {},
          charCount: 1
        }
      ]
    };
    expect(engine.isStrictlyEmptyAssistantResponse(input)).toBe(false);
    expect(() => engine.assertNotStrictlyEmpty(input)).not.toThrow();
  });
});

