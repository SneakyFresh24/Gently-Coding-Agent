import { describe, expect, it } from 'vitest';
import { PlanApprovalResolver } from './PlanApprovalResolver';
import { ExecutionPlan } from './types';

function makePlan(overrides: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    schemaVersion: 2,
    id: 'plan_1',
    goal: 'Ship feature',
    steps: [],
    status: 'awaiting_approval',
    createdAt: 1,
    currentStepIndex: 0,
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
    pendingApproval: {
      approvalRequestId: 'req_1',
      requestedAt: 1,
      timeoutMs: 300000,
      expiresAt: 300001,
      statusAtRequest: 'awaiting_approval'
    },
    ...overrides
  };
}

describe('PlanApprovalResolver', () => {
  const resolver = new PlanApprovalResolver();

  it('accepts matching approvalRequestId', () => {
    const result = resolver.resolve({
      plan: makePlan(),
      decision: 'approved',
      source: 'user',
      approvalRequestId: 'req_1'
    });

    expect(result.resolution).toBe('applied');
    expect(result.reasonCode).toBe('approved');
    expect(result.approvalRequestId).toBe('req_1');
  });

  it('rejects stale approvals when no pending request exists', () => {
    const result = resolver.resolve({
      plan: makePlan({ pendingApproval: null }),
      decision: 'approved',
      source: 'user',
      approvalRequestId: 'req_old'
    });

    expect(result.resolution).toBe('stale');
    expect(result.reasonCode).toBe('no_pending_plan_approval');
  });

  it('rejects mismatched approvalRequestId', () => {
    const result = resolver.resolve({
      plan: makePlan(),
      decision: 'approved',
      source: 'user',
      approvalRequestId: 'req_2'
    });

    expect(result.resolution).toBe('mismatch');
    expect(result.reasonCode).toBe('approval_request_id_mismatch');
    expect(result.expectedApprovalRequestId).toBe('req_1');
  });

  it('rejects user approval without approvalRequestId', () => {
    const result = resolver.resolve({
      plan: makePlan(),
      decision: 'approved',
      source: 'user'
    });

    expect(result.resolution).toBe('rejected');
    expect(result.reasonCode).toBe('missing_approval_request_id');
  });

  it('creates deterministic request metadata', () => {
    const request = resolver.createRequest(makePlan({ id: 'plan_abc' }), 1000, 5000);
    expect(request.approvalRequestId).toBe('plan_approval_plan_abc_1000');
    expect(request.timeoutMs).toBe(5000);
    expect(request.expiresAt).toBe(6000);
  });
});

