import { describe, expect, it } from 'vitest';
import { PromptBuilder } from './PromptBuilder';

describe('Prompt Golden Set', () => {
  const builder = new PromptBuilder();

  const scenarios = [
    {
      name: 'Architect planning guardrails',
      context: {
        mode: 'architect',
        tools: [{ name: 'create_plan', description: 'create a plan', parameters: {} }]
      },
      mustContain: ['MODE CONTRACT (PLAN_STRICT)', 'create_plan', 'not allowed to implement code']
    },
    {
      name: 'Code execution guardrails',
      context: {
        mode: 'code',
        tools: [{ name: 'safe_edit_file', description: 'edit', parameters: {} }]
      },
      mustContain: ['MODE CONTRACT (ACT_STRICT)', 'safe_edit_file']
    }
  ] as const;

  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const result = builder.build(scenario.context as any);
      for (const needle of scenario.mustContain) {
        expect(result.prompt).toContain(needle);
      }
      expect(result.metadata.hash.length).toBe(16);
    });
  }
});
