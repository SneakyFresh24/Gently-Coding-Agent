export interface LoopResult {
  count: number;
  softWarning: boolean;
  hardEscalation: boolean;
}

export interface LoopDetectorState {
  lastSignature?: string;
  count: number;
}

export class LoopDetector {
  private readonly softThreshold: number;
  private readonly hardThreshold: number;

  constructor(softThreshold = 3, hardThreshold = 5) {
    this.softThreshold = softThreshold;
    this.hardThreshold = hardThreshold;
  }

  check(state: LoopDetectorState, signature: string): LoopResult {
    if (state.lastSignature === signature) {
      state.count += 1;
    } else {
      state.lastSignature = signature;
      state.count = 1;
    }

    return {
      count: state.count,
      softWarning: state.count === this.softThreshold,
      hardEscalation: state.count >= this.hardThreshold
    };
  }

  reset(state: LoopDetectorState): void {
    state.lastSignature = undefined;
    state.count = 0;
  }
}

export function isStrategicSwitch(fromMode: string | undefined, toMode: string | undefined): boolean {
  if (!fromMode || !toMode) return false;
  if (fromMode === toMode) return false;
  const normalizedFrom = fromMode.toLowerCase();
  const normalizedTo = toMode.toLowerCase();
  const key = `${normalizedFrom}->${normalizedTo}`;
  const strategic = new Set(['architect->code', 'code->architect']);
  return strategic.has(key);
}
