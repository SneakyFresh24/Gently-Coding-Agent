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

  it('keeps plan in awaiting_approval on timeout and gates handover until approved', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    const approvalRequest = await manager.requestPlanApproval(plan.id);
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
