import {
  ExecutionPlan,
  PlanApprovalResolutionResult,
  PlanApprovalRequestState
} from './types';

const DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;

export class PlanApprovalResolver {
  public createRequest(plan: ExecutionPlan, now = Date.now(), timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS): PlanApprovalRequestState {
    return {
      approvalRequestId: `plan_approval_${plan.id}_${now}`,
      requestedAt: now,
      timeoutMs,
      expiresAt: now + timeoutMs,
      statusAtRequest: plan.status
    };
  }

  public resolve(params: {
    plan: ExecutionPlan;
    decision: 'approved' | 'rejected' | 'timeout';
    source: 'user' | 'policy' | 'system';
    approvalRequestId?: string;
  }): PlanApprovalResolutionResult {
    const { plan, decision, source } = params;
    const providedApprovalRequestId = String(params.approvalRequestId || '').trim();
    const pending = plan.pendingApproval || null;
    const pendingApprovalRequestId = pending?.approvalRequestId;

    if (!pending || !pendingApprovalRequestId) {
      if (decision === 'timeout') {
        return {
          resolution: 'rejected',
          reasonCode: 'approval_timeout_without_pending_request',
          planId: plan.id,
          planStatus: plan.status
        };
      }
      return {
        resolution: 'stale',
        reasonCode: 'no_pending_plan_approval',
        planId: plan.id,
        planStatus: plan.status,
        approvalRequestId: providedApprovalRequestId || undefined
      };
    }

    if (!providedApprovalRequestId) {
      if (source === 'user') {
        return {
          resolution: 'rejected',
          reasonCode: 'missing_approval_request_id',
          planId: plan.id,
          planStatus: plan.status,
          expectedApprovalRequestId: pendingApprovalRequestId
        };
      }
    } else if (providedApprovalRequestId !== pendingApprovalRequestId) {
      return {
        resolution: 'mismatch',
        reasonCode: 'approval_request_id_mismatch',
        planId: plan.id,
        planStatus: plan.status,
        approvalRequestId: providedApprovalRequestId,
        expectedApprovalRequestId: pendingApprovalRequestId
      };
    }

    if (decision === 'timeout') {
      return {
        resolution: 'applied',
        reasonCode: 'approval_timeout',
        planId: plan.id,
        planStatus: 'awaiting_approval',
        approvalRequestId: pendingApprovalRequestId
      };
    }

    return {
      resolution: 'applied',
      reasonCode: decision === 'approved' ? 'approved' : 'rejected',
      planId: plan.id,
      planStatus: decision,
      approvalRequestId: pendingApprovalRequestId
    };
  }
}

