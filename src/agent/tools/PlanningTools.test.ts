import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanningTools } from './PlanningTools';
import { ToolRegistry } from './ToolRegistry';

let requireApprovalValue = true;

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => {
        if (key === 'planning.requireApproval') return requireApprovalValue;
        return fallback;
      }
    })
  }
}));

describe('PlanningTools', () => {
  const createRegistryWithPlanningTools = (tools: PlanningTools): ToolRegistry => {
    const registry = new ToolRegistry();
    const noopTool = { execute: vi.fn().mockResolvedValue({ success: true }) } as any;
    const seededTools = [
      'read_file',
      'list_files',
      'analyze_project_structure',
      'write_file',
      'safe_edit_file',
      'apply_block_edit',
      'find_files',
      'regex_search'
    ] as const;
    seededTools.forEach((toolName) => registry.register(toolName, noopTool));
    tools.registerTools(registry);
    return registry;
  };

  beforeEach(() => {
    requireApprovalValue = true;
  });

  it('auto-approves create_plan through request-bound approval when policy disables manual approval', async () => {
    requireApprovalValue = false;

    const planningManagerMock = {
      createPlan: vi.fn().mockReturnValue({
        id: 'plan_auto',
        goal: 'Implement feature',
        steps: [{ id: 'step-1', description: 'Read files', tool: 'read_file', parameters: {}, status: 'pending' }],
        status: 'created'
      }),
      announcePlanCreated: vi.fn().mockResolvedValue(undefined),
      requestPlanApproval: vi.fn().mockResolvedValue({ approvalRequestId: 'req_auto' }),
      resolvePlanApproval: vi.fn().mockResolvedValue(undefined),
      getCurrentPlan: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const createPlanTool = registry.get('create_plan');
    const result = await createPlanTool?.execute({
      goal: 'Implement feature',
      steps: [{ description: 'Read files', tool: 'read_file', parameters: {} }]
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('approved');
    expect(planningManagerMock.requestPlanApproval).toHaveBeenCalledWith('plan_auto');
    expect(planningManagerMock.resolvePlanApproval).toHaveBeenCalledWith(
      'plan_auto',
      'approved',
      'auto_approved_by_policy',
      'policy',
      { approvalRequestId: 'req_auto' }
    );
  });

  it('registers and executes create_plan successfully', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      createPlan: vi.fn().mockReturnValue({
        id: 'plan_123',
        goal: 'Implement feature',
        steps: [{ id: 'step-1', description: 'Read files', tool: 'read_file', parameters: {}, status: 'pending' }],
        status: 'created'
      }),
      announcePlanCreated: vi.fn().mockResolvedValue(undefined),
      requestPlanApproval: vi.fn().mockResolvedValue(undefined),
      resolvePlanApproval: vi.fn().mockResolvedValue(undefined),
      getCurrentPlan: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const createPlanTool = registry.get('create_plan');
    const result = await createPlanTool?.execute({
      goal: 'Implement feature',
      steps: [{ description: 'Read files', tool: 'read_file', parameters: {} }],
      files: [{ path: 'src/main.ts', purpose: 'entry point', type: 'ts' }]
    });

    expect(createPlanTool).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.planId).toBe('plan_123');
    expect(result.status).toBe('awaiting_approval');
    expect(planningManagerMock.createPlan).toHaveBeenCalledTimes(1);
    expect(planningManagerMock.announcePlanCreated).toHaveBeenCalledTimes(1);
    expect(planningManagerMock.requestPlanApproval).toHaveBeenCalledTimes(1);
  });

  it('blocks handover_to_coder when no active plan exists', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      createPlan: vi.fn(),
      announcePlanCreated: vi.fn(),
      getCurrentPlan: vi.fn().mockReturnValue(undefined),
      handoverToCoder: vi.fn(),
      canHandover: vi.fn().mockReturnValue({ ok: false, reason: 'Plan must be approved before handover.' })
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const handoverTool = registry.get('handover_to_coder');
    const result = await handoverTool?.execute({ message: 'handover' });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('No active plan found');
    expect(planningManagerMock.handoverToCoder).not.toHaveBeenCalled();
  });

  it('keeps repeated handover blocked while plan is awaiting approval (no churn)', async () => {
    requireApprovalValue = true;

    const currentPlan = {
      id: 'plan_waiting',
      steps: [{ id: 'step-1' }],
      status: 'awaiting_approval',
      pendingApproval: { approvalRequestId: 'req_1' }
    };

    const planningManagerMock = {
      getCurrentPlan: vi.fn().mockReturnValue(currentPlan),
      canHandover: vi.fn().mockReturnValue({
        ok: false,
        reason: 'Plan must be approved before handover (current: awaiting_approval).'
      }),
      requestPlanApproval: vi.fn(),
      resolvePlanApproval: vi.fn(),
      markHandedOver: vi.fn(),
      handoverToCoder: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const handoverTool = registry.get('handover_to_coder');
    const first = await handoverTool?.execute({ message: 'handover #1' });
    const second = await handoverTool?.execute({ message: 'handover #2' });

    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    expect(planningManagerMock.handoverToCoder).not.toHaveBeenCalled();
    expect(planningManagerMock.requestPlanApproval).not.toHaveBeenCalled();
    expect(planningManagerMock.resolvePlanApproval).not.toHaveBeenCalled();
  });

  it('rejects create_plan with cyclic dependencies', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      createPlan: vi.fn(),
      announcePlanCreated: vi.fn(),
      requestPlanApproval: vi.fn(),
      resolvePlanApproval: vi.fn(),
      getCurrentPlan: vi.fn().mockReturnValue(undefined)
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const createPlanTool = registry.get('create_plan');
    const result = await createPlanTool?.execute({
      goal: 'Ship feature',
      steps: [
        { id: 'a', description: 'Step A', tool: 'read_file', parameters: {}, dependencies: ['b'] },
        { id: 'b', description: 'Step B', tool: 'read_file', parameters: {}, dependencies: ['a'] }
      ]
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('cycle');
    expect(planningManagerMock.createPlan).not.toHaveBeenCalled();
  });

  it('blocks create_plan when an existing plan is awaiting approval', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      createPlan: vi.fn(),
      announcePlanCreated: vi.fn(),
      requestPlanApproval: vi.fn(),
      resolvePlanApproval: vi.fn(),
      getCurrentPlan: vi.fn().mockReturnValue({
        id: 'plan_open',
        status: 'awaiting_approval',
        pendingApproval: {
          approvalRequestId: 'req_open'
        }
      })
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const createPlanTool = registry.get('create_plan');
    const result = await createPlanTool?.execute({
      goal: 'Ship feature',
      steps: [{ description: 'Read files', tool: 'read_file', parameters: {} }]
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('awaiting approval');
    expect(planningManagerMock.createPlan).not.toHaveBeenCalled();
  });

  it('does not auto-approve pending plan before handover', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      getCurrentPlan: vi
        .fn()
        .mockReturnValue({ id: 'plan_approved', steps: [{ id: 'step-1' }], status: 'awaiting_approval', pendingApproval: { approvalRequestId: 'req_handover' } }),
      canHandover: vi.fn().mockReturnValue({ ok: false, code: 'PLAN_APPROVAL_PENDING_EXPLICIT', reason: 'Plan must be approved before handover.' }),
      resolvePlanApproval: vi.fn().mockResolvedValue(undefined),
      markHandedOver: vi.fn().mockResolvedValue(undefined),
      handoverToCoder: vi.fn(),
      requestPlanApproval: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const handoverTool = registry.get('handover_to_coder');
    const result = await handoverTool?.execute({ message: 'handover' });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PLAN_APPROVAL_PENDING_EXPLICIT');
    expect(planningManagerMock.resolvePlanApproval).not.toHaveBeenCalled();
    expect(planningManagerMock.handoverToCoder).not.toHaveBeenCalled();
  });

  it('does not create fresh approval request for handover auto-approve when pending request id is missing', async () => {
    requireApprovalValue = true;

    const planningManagerMock = {
      getCurrentPlan: vi
        .fn()
        .mockReturnValue({ id: 'plan_waiting', steps: [{ id: 'step-1' }], status: 'awaiting_approval', pendingApproval: null }),
      canHandover: vi.fn().mockReturnValue({ ok: false, code: 'PLAN_APPROVAL_PENDING_EXPLICIT', reason: 'Plan must be approved before handover.' }),
      requestPlanApproval: vi.fn().mockResolvedValue({ approvalRequestId: 'req_new' }),
      resolvePlanApproval: vi.fn().mockResolvedValue(undefined),
      markHandedOver: vi.fn().mockResolvedValue(undefined),
      handoverToCoder: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const handoverTool = registry.get('handover_to_coder');
    const result = await handoverTool?.execute({ message: 'handover' });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PLAN_APPROVAL_PENDING_EXPLICIT');
    expect(planningManagerMock.requestPlanApproval).not.toHaveBeenCalled();
    expect(planningManagerMock.resolvePlanApproval).not.toHaveBeenCalled();
    expect(planningManagerMock.handoverToCoder).not.toHaveBeenCalled();
  });

  it('routes update_plan_steps through deterministic step engine', async () => {
    const applyStepUpdates = vi.fn().mockResolvedValue({
      success: true,
      planId: 'plan_exec',
      updated: [{ stepId: 'step-1', status: 'in_progress' }],
      skipped: [],
      planStatus: 'executing'
    });

    const planningManagerMock = {
      getCurrentPlan: vi.fn().mockReturnValue({ id: 'plan_exec', status: 'executing', steps: [] }),
      getPlan: vi.fn().mockReturnValue({ id: 'plan_exec', status: 'executing', steps: [] }),
      applyStepUpdates
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const updateTool = registry.get('update_plan_steps');
    const result = await updateTool?.execute({
      planId: 'plan_exec',
      updates: [{ stepId: 'step-1', status: 'in_progress' }]
    });

    expect(result.success).toBe(true);
    expect(applyStepUpdates).toHaveBeenCalledWith('plan_exec', [
      { stepId: 'step-1', status: 'in_progress', reason: undefined, result: undefined }
    ]);
  });

  it('propagates deterministic pre-handover block from step engine', async () => {
    const applyStepUpdates = vi.fn().mockResolvedValue({
      success: false,
      code: 'PLAN_PRE_HANDOVER_STEP_UPDATES_BLOCKED',
      error: 'Pre-handover step updates are blocked. Handover to coder first.',
      planId: 'plan_pre_handover',
      updated: [],
      skipped: [],
      planStatus: 'approved'
    });

    const planningManagerMock = {
      getCurrentPlan: vi.fn().mockReturnValue({ id: 'plan_pre_handover', status: 'approved', steps: [] }),
      getPlan: vi.fn().mockReturnValue({ id: 'plan_pre_handover', status: 'approved', steps: [] }),
      applyStepUpdates
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);
    const updateTool = registry.get('update_plan_steps');
    const result = await updateTool?.execute({
      planId: 'plan_pre_handover',
      updates: [{ stepId: 'step-1', status: 'in_progress' }]
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('PLAN_PRE_HANDOVER_STEP_UPDATES_BLOCKED');
  });

  it('rejects update_plan_steps when updates are empty', async () => {
    const planningManagerMock = {
      getCurrentPlan: vi.fn().mockReturnValue({ id: 'plan_exec', status: 'executing', steps: [] }),
      getPlan: vi.fn().mockReturnValue({ id: 'plan_exec', status: 'executing', steps: [] }),
      applyStepUpdates: vi.fn()
    };

    const tools = new PlanningTools(planningManagerMock as any, null);
    const registry = createRegistryWithPlanningTools(tools);

    const updateTool = registry.get('update_plan_steps');
    const result = await updateTool?.execute({
      planId: 'plan_exec',
      updates: []
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('at least one step update');
  });
});
