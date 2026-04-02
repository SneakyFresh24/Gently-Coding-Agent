import type { FamilyOverrideSpec } from './types';

export const MINIMAX_OVERRIDE: FamilyOverrideSpec = {
  family: 'minimax',
  overrides: [
    {
      component: 'recovery_policy',
      strategy: 'append',
      content: `MINIMAX FAMILY OVERRIDE:
- Keep tool-call JSON simple and complete.
- Prefer smaller edit chunks over one large write.
- Validate argument syntax before retrying.`
    }
  ]
};

