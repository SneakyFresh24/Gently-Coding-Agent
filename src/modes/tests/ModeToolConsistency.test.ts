import { describe, it, expect } from 'vitest';
import { ArchitectMode } from '../ArchitectMode';
import { CodeMode } from '../CodeMode';
import { TOOL_DEFINITIONS } from '../../agent/tools/definitions';

describe('Mode tool consistency', () => {
  const registeredTools = new Set(Object.keys(TOOL_DEFINITIONS));

  it('architect mode only references registered tools', () => {
    const mode = new ArchitectMode();
    const missing = mode.availableTools.filter((tool) => !registeredTools.has(tool as string));
    expect(missing).toEqual([]);
  });

  it('code mode only references registered tools', () => {
    const mode = new CodeMode();
    const missing = mode.availableTools.filter((tool) => !registeredTools.has(tool as string));
    expect(missing).toEqual([]);
  });
});
