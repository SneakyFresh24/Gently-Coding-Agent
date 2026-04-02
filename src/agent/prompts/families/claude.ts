import type { FamilyOverrideSpec } from './types';

export const CLAUDE_OVERRIDE: FamilyOverrideSpec = {
  family: 'claude',
  overrides: [
    {
      component: 'tool_policy',
      strategy: 'append',
      content: `CLAUDE FAMILY OVERRIDE:
- Use extended thinking for complex multi-step reasoning.
- Prefer task_progress for tasks with 3+ steps.
- Keep tool arguments in valid JSON format.`
    }
  ]
};

