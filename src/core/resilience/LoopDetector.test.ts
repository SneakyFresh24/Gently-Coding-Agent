import { describe, expect, it } from 'vitest';
import { isStrategicSwitch, LoopDetector } from './LoopDetector';

describe('LoopDetector', () => {
  it('emits soft warning at 3 and hard escalation at 5', () => {
    const detector = new LoopDetector(3, 5);
    const state = { count: 0 };

    detector.check(state, 'sig');
    detector.check(state, 'sig');
    const soft = detector.check(state, 'sig');
    expect(soft.softWarning).toBe(true);
    expect(soft.hardEscalation).toBe(false);

    detector.check(state, 'sig');
    const hard = detector.check(state, 'sig');
    expect(hard.hardEscalation).toBe(true);
  });

  it('resets count when signature changes', () => {
    const detector = new LoopDetector(3, 5);
    const state = { count: 0 };
    detector.check(state, 'a');
    detector.check(state, 'a');
    const switched = detector.check(state, 'b');
    expect(switched.count).toBe(1);
  });
});

describe('isStrategicSwitch', () => {
  it('treats architect<->code as strategic', () => {
    expect(isStrategicSwitch('architect', 'code')).toBe(true);
    expect(isStrategicSwitch('code', 'architect')).toBe(true);
  });

  it('does not treat same mode as strategic', () => {
    expect(isStrategicSwitch('code', 'code')).toBe(false);
  });
});
