import type { FamilyOverrideSpec } from './types';

export const GPT_OVERRIDE: FamilyOverrideSpec = {
  family: 'gpt',
  overrides: [
    {
      component: 'rules',
      strategy: 'append',
      content: `GPT FAMILY OVERRIDE:
- Use native JSON tool parameters and keep them compact.
- Execute independent multi-file operations in one parallel tool block.
- After 2 failed attempts, switch strategy immediately.`
    }
  ]
};
