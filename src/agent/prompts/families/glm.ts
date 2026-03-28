import type { FamilyOverrideSpec } from './types';

export const GLM_OVERRIDE: FamilyOverrideSpec = {
  family: 'glm',
  overrides: [
    {
      component: 'rules',
      strategy: 'append',
      content: `GLM FAMILY OVERRIDE:
- Prefer explicit, unambiguous parameter names.
- Use smaller, atomic operations over complex monolithic calls.
- Keep retries deterministic and strategy-focused.`
    }
  ]
};
