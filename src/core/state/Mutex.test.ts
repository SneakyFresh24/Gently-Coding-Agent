import { describe, expect, it } from 'vitest';
import { Mutex } from './Mutex';

describe('Mutex', () => {
  it('serializes access for concurrent callers', async () => {
    const mutex = new Mutex();
    const order: string[] = [];

    const first = mutex.runExclusive(async () => {
      order.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('first:end');
    });

    const second = mutex.runExclusive(async () => {
      order.push('second:start');
      order.push('second:end');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('times out lock acquisition and does not run timed out callback later', async () => {
    const mutex = new Mutex();
    const executed: string[] = [];

    const holder = mutex.runExclusive(async () => {
      executed.push('holder:start');
      await new Promise((resolve) => setTimeout(resolve, 80));
      executed.push('holder:end');
    });

    await expect(
      mutex.runExclusive(
        async () => {
          executed.push('timedOut:ran');
        },
        20
      )
    ).rejects.toThrow('Mutex acquire timeout');

    await holder;
    expect(executed).not.toContain('timedOut:ran');
  });
});
