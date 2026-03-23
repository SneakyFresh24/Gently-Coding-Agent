import { describe, expect, it, vi } from 'vitest';
import { PlanningTools } from './PlanningTools';
import { ToolRegistry } from './ToolRegistry';

describe('PlanningTools', () => {
  it('registers and executes create_plan successfully', async () => {
    const planningManagerMock = {
      createPlan: vi.fn().mockReturnValue({
        id: 'plan_123',
        goal: 'Implement feature',
        steps: [{ id: 'step-1', description: 'Read files', tool: 'read_file', parameters: {}, status: 'pending' }]
      }),
      announcePlanCreated: vi.fn().mockResolvedValue(undefined),
      getCurrentPlan: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = new ToolRegistry();
    tools.registerTools(registry);

    const createPlanTool = registry.get('create_plan');
    const result = await createPlanTool?.execute({
      goal: 'Implement feature',
      steps: [{ description: 'Read files', tool: 'read_file', parameters: {} }],
      files: [{ path: 'src/main.ts', purpose: 'entry point', type: 'ts' }]
    });

    expect(createPlanTool).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.planId).toBe('plan_123');
    expect(planningManagerMock.createPlan).toHaveBeenCalledTimes(1);
    expect(planningManagerMock.announcePlanCreated).toHaveBeenCalledTimes(1);
  });

  it('blocks handover_to_coder when no active plan exists', async () => {
    const planningManagerMock = {
      createPlan: vi.fn(),
      announcePlanCreated: vi.fn(),
      getCurrentPlan: vi.fn().mockReturnValue(undefined),
      handoverToCoder: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = new ToolRegistry();
    tools.registerTools(registry);

    const handoverTool = registry.get('handover_to_coder');
    const result = await handoverTool?.execute({ message: 'handover' });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('No active plan found');
    expect(planningManagerMock.handoverToCoder).not.toHaveBeenCalled();
  });
});
