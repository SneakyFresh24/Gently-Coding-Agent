import { describe, expect, it } from 'vitest';
import { PlanningManager } from './PlanningManager';

describe('PlanningManager lifecycle hardening', () => {
  it('generates deterministic and unique step IDs', () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [
        { id: 'Setup', description: 'Setup workspace', tool: 'list_files', parameters: {} },
        { id: 'setup', description: 'Setup workspace again', tool: 'list_files', parameters: {} },
        { description: 'Read important file', tool: 'read_file', parameters: {} }
      ]
    });

    const stepIds = plan.steps.map((step) => step.id);
    expect(stepIds.length).toBe(3);
    expect(new Set(stepIds).size).toBe(3);
    expect(stepIds[0]).toBe('setup');
    expect(stepIds[1]).toBe('setup-2');
    expect(stepIds[2]).toMatch(/^step-3-/);
  });

  it('rejects invalid status transitions and allows valid ones', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    await expect(manager.updatePlanStatus(plan.id, 'handed_over')).rejects.toThrow(
      'Invalid plan status transition: created -> handed_over'
    );

    await expect(manager.updatePlanStatus(plan.id, 'awaiting_approval')).resolves.toBeUndefined();
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');
  });

  it('does not auto-timeout plan approval and gates handover until approved', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    const approvalRequest = await manager.requestPlanApproval(plan.id);
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');
    expect(approvalRequest.timeoutMs).toBeUndefined();
    expect(approvalRequest.expiresAt).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');

    await manager.resolvePlanApproval(plan.id, 'timeout', 'approval_timeout', 'system', {
      approvalRequestId: approvalRequest.approvalRequestId
    });
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');
    expect(manager.canHandover(plan.id).ok).toBe(false);

    await manager.resolvePlanApproval(plan.id, 'approved', 'approved_by_user', 'user', {
      approvalRequestId: approvalRequest.approvalRequestId
    });
    expect(manager.canHandover(plan.id).ok).toBe(true);

    await manager.markHandedOver(plan.id);
    expect(manager.getPlan(plan.id)?.status).toBe('handed_over');
  });

  it('blocks pre-handover step updates and keeps plan approved', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    const approvalRequest = await manager.requestPlanApproval(plan.id);
    await manager.resolvePlanApproval(plan.id, 'approved', 'approved_by_user', 'user', {
      approvalRequestId: approvalRequest.approvalRequestId
    });

    const result = await manager.applyStepUpdates(plan.id, [
      { stepId: plan.steps[0].id, status: 'in_progress' }
    ]);

    expect(result.success).toBe(false);
    expect(result.code).toBe('PLAN_PRE_HANDOVER_STEP_UPDATES_BLOCKED');
    expect(manager.getPlan(plan.id)?.status).toBe('approved');
    expect(manager.getPlan(plan.id)?.steps[0]?.status).toBe('pending');
  });

  it('rejects stale or mismatched approval request ids', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    const approvalRequest = await manager.requestPlanApproval(plan.id);
    const mismatch = await manager.resolvePlanApproval(plan.id, 'approved', 'mismatch', 'user', {
      approvalRequestId: `${approvalRequest.approvalRequestId}_other`
    });
    expect(mismatch.resolution).toBe('mismatch');
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');

    const stale = await manager.resolvePlanApproval(plan.id, 'approved', 'stale', 'user');
    expect(stale.resolution).toBe('rejected');
    expect(stale.reasonCode).toBe('missing_approval_request_id');
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');
  });
});
