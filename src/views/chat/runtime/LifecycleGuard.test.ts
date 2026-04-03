import { describe, expect, it, vi } from 'vitest';
import { LifecycleGuard } from './LifecycleGuard';

describe('LifecycleGuard', () => {
  it('suppresses duplicate lifecycle start/end events', () => {
    const send = vi.fn();
    const guard = new LifecycleGuard(send);

    guard.dispatch({ type: 'processingStart' });
    guard.dispatch({ type: 'processingStart' });
    guard.dispatch({ type: 'generatingStart' });
    guard.dispatch({ type: 'generatingStart' });
    guard.dispatch({ type: 'generatingEnd' });
    guard.dispatch({ type: 'generatingEnd' });
    guard.dispatch({ type: 'processingEnd' });
    guard.dispatch({ type: 'processingEnd' });

    expect(send.mock.calls.map((call) => call[0].type)).toEqual([
      'processingStart',
      'generatingStart',
      'generatingEnd',
      'processingEnd'
    ]);
  });

  it('forwards non-lifecycle events unchanged', () => {
    const send = vi.fn();
    const guard = new LifecycleGuard(send);
    const payload = { type: 'assistantMessageChunk', chunk: 'hello' };
    guard.dispatch(payload);
    expect(send).toHaveBeenCalledWith(payload);
  });

  it('forceFinalize closes open lifecycle scopes exactly once', () => {
    const send = vi.fn();
    const guard = new LifecycleGuard(send);

    guard.dispatch({ type: 'processingStart' });
    guard.dispatch({ type: 'generatingStart' });
    guard.forceFinalize();
    guard.forceFinalize();

    expect(send.mock.calls.map((call) => call[0].type)).toEqual([
      'processingStart',
      'generatingStart',
      'generatingEnd',
      'processingEnd'
    ]);
  });
});

