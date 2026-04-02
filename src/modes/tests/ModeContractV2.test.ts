import { describe, expect, it } from 'vitest';
import {
  getModeContractViolation,
  isToolAllowedForModeContract,
  resolveModeContract
} from '../ModeContractV2';

describe('ModeContractV2', () => {
  it('resolves architect/code contracts deterministically', () => {
    expect(resolveModeContract('architect')).toBe('PLAN_STRICT');
    expect(resolveModeContract('code')).toBe('ACT_STRICT');
    expect(resolveModeContract('unknown')).toBe('UNKNOWN');
  });

  it('blocks mutating tools in PLAN_STRICT', () => {
    expect(isToolAllowedForModeContract('architect', 'read_file')).toBe(true);
    expect(isToolAllowedForModeContract('architect', 'write_file')).toBe(false);
    expect(getModeContractViolation('architect', 'write_file')).toContain('PLAN_STRICT');
  });

  it('blocks planning tools in ACT_STRICT', () => {
    expect(isToolAllowedForModeContract('code', 'create_plan')).toBe(false);
    expect(isToolAllowedForModeContract('code', 'write_file')).toBe(true);
    expect(getModeContractViolation('code', 'create_plan')).toContain('ACT_STRICT');
  });
});

