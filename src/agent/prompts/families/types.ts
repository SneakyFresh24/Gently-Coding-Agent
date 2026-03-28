import type { PromptComponentId } from '../types';

export type PromptFamily = 'claude' | 'gpt' | 'gemini' | 'minimax' | 'glm' | 'grok' | 'unknown';
export type MergeStrategy = 'append' | 'prepend' | 'replace';

export interface FamilyOverrideEntry {
  component: PromptComponentId;
  strategy?: MergeStrategy;
  content: string;
}

export interface FamilyOverrideSpec {
  family: PromptFamily;
  overrides: FamilyOverrideEntry[];
}
