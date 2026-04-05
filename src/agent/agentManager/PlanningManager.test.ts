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

  it('auto-handover approved plans on prepareCodeEntry and is idempotent', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Implement', tool: 'write_file', parameters: {} }]
    });

    const approvalRequest = await manager.requestPlanApproval(plan.id);
    await manager.resolvePlanApproval(plan.id, 'approved', 'approved_by_user', 'user', {
      approvalRequestId: approvalRequest.approvalRequestId
    });

    const first = await manager.prepareCodeEntry(plan.id);
    expect(first.ok).toBe(true);
    expect(first.code).toBe('CODE_ENTRY_AUTO_HANDOVER_APPLIED');
    expect(first.autoHandedOver).toBe(true);
    expect(manager.getPlan(plan.id)?.status).toBe('handed_over');

    const second = await manager.prepareCodeEntry(plan.id);
    expect(second.ok).toBe(true);
    expect(second.code).toBe('CODE_ENTRY_ALLOWED');
    expect(second.autoHandedOver).toBe(false);
    expect(manager.getPlan(plan.id)?.status).toBe('handed_over');
  });

  it('blocks code entry while plan is awaiting approval', async () => {
    const manager = new PlanningManager();
    const plan = manager.createPlan({
      goal: 'Ship feature',
      steps: [{ description: 'Analyze code', tool: 'analyze_project_structure', parameters: {} }]
    });

    await manager.requestPlanApproval(plan.id);
    const result = await manager.prepareCodeEntry(plan.id);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PLAN_APPROVAL_PENDING_EXPLICIT');
    expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');
  });

  it('keeps lifecycle consistent for five sequential message-like plan runs', async () => {
    const manager = new PlanningManager();
    const completedPlanIds = new Set<string>();

    for (let index = 0; index < 5; index++) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      const plan = manager.createPlan({
        goal: `Message ${index + 1}: implement requested change`,
        steps: [
          {
            description: `Execute step for message ${index + 1}`,
            tool: 'write_file',
            parameters: {}
          }
        ]
      });

      expect(plan.status).toBe('created');
      expect(plan.steps).toHaveLength(1);

      const approvalRequest = await manager.requestPlanApproval(plan.id);
      expect(manager.getPlan(plan.id)?.status).toBe('awaiting_approval');

      const approvalResolution = await manager.resolvePlanApproval(
        plan.id,
        'approved',
        `approved_message_${index + 1}`,
        'user',
        {
          approvalRequestId: approvalRequest.approvalRequestId
        }
      );
      expect(approvalResolution.resolution).toBe('applied');
      expect(manager.getPlan(plan.id)?.status).toBe('approved');

      const codeEntry = await manager.prepareCodeEntry(plan.id);
      expect(codeEntry.ok).toBe(true);

      const stepId = plan.steps[0]?.id;
      expect(stepId).toBeTruthy();

      const progressUpdate = await manager.applyStepUpdates(plan.id, [
        {
          stepId: String(stepId),
          status: 'in_progress',
          reason: `started_message_${index + 1}`
        }
      ]);
      expect(progressUpdate.success).toBe(true);
      expect(manager.getPlan(plan.id)?.status).toBe('executing');

      const completionUpdate = await manager.applyStepUpdates(plan.id, [
        {
          stepId: String(stepId),
          status: 'completed',
          result: { messageIndex: index + 1 }
        }
      ]);
      expect(completionUpdate.success).toBe(true);

      const finalPlan = manager.getPlan(plan.id);
      expect(finalPlan?.status).toBe('completed');
      expect(finalPlan?.pendingApproval).toBeNull();
      expect(finalPlan?.completedSteps).toBe(1);
      expect(finalPlan?.failedSteps).toBe(0);
      expect(finalPlan?.steps[0]?.status).toBe('completed');

      completedPlanIds.add(plan.id);
    }

    expect(completedPlanIds.size).toBe(5);
    const currentPlan = manager.getCurrentPlan();
    expect(currentPlan?.status).toBe('completed');
    expect(currentPlan?.pendingApproval).toBeNull();
    expect(currentPlan?.steps.every((step) => step.status === 'completed')).toBe(true);
  });

  it('supports session-scoped plan selection via setCurrentPlanId', () => {
    const manager = new PlanningManager();
    const planA = manager.createPlan({
      goal: 'Plan A',
      steps: [{ description: 'A', tool: 'read_file', parameters: {} }]
    });
    const planB = manager.createPlan({
      goal: 'Plan B',
      steps: [{ description: 'B', tool: 'read_file', parameters: {} }]
    });

    manager.setCurrentPlanId(planA.id);
    expect(manager.getCurrentPlanId()).toBe(planA.id);
    expect(manager.getCurrentPlan()?.id).toBe(planA.id);

    manager.setCurrentPlanId(planB.id);
    expect(manager.getCurrentPlanId()).toBe(planB.id);
    expect(manager.getCurrentPlan()?.id).toBe(planB.id);

    manager.setCurrentPlanId('');
    expect(manager.getCurrentPlanId()).toBeUndefined();
    expect(manager.getCurrentPlan()).toBeUndefined();
  });
});
