import { detectModelFamily as detectPolicyFamily } from '../../../utils/modelPolicy';
import type { PromptTextBlocks } from '../PromptRegistry';
import { CLAUDE_OVERRIDE } from './claude';
import { GEMINI_OVERRIDE } from './gemini';
import { GLM_OVERRIDE } from './glm';
import { GPT_OVERRIDE } from './gpt';
import { GROK_OVERRIDE } from './grok';
import { MINIMAX_OVERRIDE } from './minimax';
import type { FamilyOverrideEntry, FamilyOverrideSpec, MergeStrategy, PromptFamily } from './types';
import { UNKNOWN_OVERRIDE } from './unknown';

const FAMILY_OVERRIDES: Record<PromptFamily, FamilyOverrideSpec> = {
  claude: CLAUDE_OVERRIDE,
  gpt: GPT_OVERRIDE,
  gemini: GEMINI_OVERRIDE,
  minimax: MINIMAX_OVERRIDE,
  glm: GLM_OVERRIDE,
  grok: GROK_OVERRIDE,
  unknown: UNKNOWN_OVERRIDE
};

export function detectPromptFamily(modelId?: string | null): PromptFamily {
  const detected = detectPolicyFamily(modelId || undefined);
  if (detected === 'claude' || detected === 'gpt' || detected === 'gemini' || detected === 'minimax' || detected === 'glm' || detected === 'grok') {
    return detected;
  }
  return 'unknown';
}

export function getFamilyOverrideSpec(modelId?: string | null): FamilyOverrideSpec {
  return FAMILY_OVERRIDES[detectPromptFamily(modelId)] || UNKNOWN_OVERRIDE;
}

function toBlockKey(component: FamilyOverrideEntry['component']): keyof PromptTextBlocks | null {
  if (component === 'runtime_hints') return 'runtimeHints';
  if (component === 'identity') return 'identity';
  if (component === 'objective') return 'objective';
  if (component === 'rules') return 'rules';
  if (component === 'examples') return 'examples';
  return null;
}

function mergeComponent(base: string, content: string, strategy: MergeStrategy): string {
  const left = base || '';
  const right = content || '';
  if (strategy === 'replace') return right.trim();
  if (strategy === 'prepend') return `${right}\n${left}`.trim();
  return `${left}\n${right}`.trim();
}

export function applyFamilyOverrides(base: PromptTextBlocks, spec: FamilyOverrideSpec): PromptTextBlocks {
  const merged: PromptTextBlocks = { ...base };
  for (const entry of spec.overrides) {
    const key = toBlockKey(entry.component);
    if (!key) continue;
    merged[key] = mergeComponent(merged[key], entry.content, entry.strategy || 'append');
  }
  return merged;
}

export type { FamilyOverrideEntry, FamilyOverrideSpec, MergeStrategy, PromptFamily } from './types';
