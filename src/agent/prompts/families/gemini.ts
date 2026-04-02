import type { FamilyOverrideSpec } from './types';

export const GEMINI_OVERRIDE: FamilyOverrideSpec = {
  family: 'gemini',
  overrides: [
    {
      component: 'output_contract',
      strategy: 'append',
      content: `GEMINI FAMILY OVERRIDE:
- Keep responses concise and structured.
- Prefer clear bullet points over long prose.
- Use task_progress for longer multi-step tasks.`
    }
  ]
};

