import { describe, expect, it } from 'vitest';
import { StreamRecoveryManager } from '../StreamRecoveryManager';

describe('StreamRecoveryManager', () => {
  it('dedupes replayed text after reconnect', () => {
    const manager = new StreamRecoveryManager();
    const first = manager.process({ type: 'text', text: 'Hello' });
    expect(first).toHaveLength(1);
    expect((first[0] as any).text).toBe('Hello');

    manager.beginReconnectAttempt();
    const replay = manager.process({ type: 'text', text: 'Hello' });
    expect(replay).toHaveLength(0);

    const suffix = manager.process({ type: 'text', text: ' world' });
    expect(suffix).toHaveLength(1);
    expect((suffix[0] as any).text).toBe(' world');
  });

  it('dedupes replayed tool call deltas', () => {
    const manager = new StreamRecoveryManager();
    const initial = manager.process({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      delta: '{"path":"a.ts"}',
      index: 0
    });
    expect(initial).toHaveLength(1);
    expect((initial[0] as any).delta).toBe('{"path":"a.ts"}');

    manager.beginReconnectAttempt();
    const replay = manager.process({
      type: 'tool_call_delta',
      toolCallId: 'call_1',
      delta: '{"path":"a.ts"}',
      index: 0
    });
    expect(replay).toHaveLength(0);
  });

  it('emits message_stop only once across reconnect replay', () => {
    const manager = new StreamRecoveryManager();
    const first = manager.process({ type: 'message_stop' });
    expect(first).toHaveLength(1);

    manager.beginReconnectAttempt();
    const replay = manager.process({ type: 'message_stop' });
    expect(replay).toHaveLength(0);
  });
});
