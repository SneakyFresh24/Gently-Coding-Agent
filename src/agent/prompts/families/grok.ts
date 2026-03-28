import type { FamilyOverrideSpec } from './types';

export const GROK_OVERRIDE: FamilyOverrideSpec = {
  family: 'grok',
  overrides: [
    {
      component: 'rules',
      strategy: 'append',
      content: `GROK FAMILY OVERRIDE:
- Use direct, concise responses.
- Treat message.content as the authoritative final answer channel.
- Keep tool-call arguments explicit and stable.`
    }
  ]
};
