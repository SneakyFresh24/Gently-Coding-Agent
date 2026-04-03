// =====================================================
// PlanningManager - New Task-Oriented Architecture
// =====================================================

import {
  ExecutionPlan,
  CreatePlanParams,
  PlanExecutionResult,
  PlanStep,
  PlanEvent,
  PlanLifecycleStatus,
  PlanApprovalRequestState,
  PlanApprovalResolutionResult,
  PlanStepStatusUpdate,
  TaskStatus
} from '../planning';
import { PlanApprovalResolver } from '../planning/PlanApprovalResolver';
import { TaskState } from '../../core/task/TaskState';
import { Task } from '../../core/task/Task';
import { MessageStateHandler } from '../../core/task/MessageStateHandler';
import { ToolManager } from './ToolManager';
import { IAgentService } from './interfaces';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanningManager');

export class PlanningManager implements IAgentService {
  private static readonly PLAN_SCHEMA_VERSION = 2;
  private static readonly DEFAULT_APPROVAL_TIMEOUT_MS = 300_000;
  private static readonly PLAN_STATUS_TRANSITIONS: Record<PlanLifecycleStatus, PlanLifecycleStatus[]> = {
    draft: ['created'],
    created: ['awaiting_approval', 'approved', 'rejected', 'executing'],
    awaiting_approval: ['approved', 'rejected'],
    approved: ['handed_over', 'executing', 'rejected'],
    rejected: ['draft', 'created'],
    handed_over: ['executing', 'failed'],
    executing: ['completed', 'failed', 'paused'],
    paused: ['executing', 'failed'],
    completed: [],
    failed: [],
    pending: ['created', 'awaiting_approval', 'approved', 'executing', 'failed', 'paused']
  };

  private toolManager!: ToolManager;
  private taskState: TaskState;
  private messageHandler: MessageStateHandler;
  private currentTask: Task | null = null;
  private persistPlanFn?: (plan: ExecutionPlan) => Promise<void>;
  private readonly approvalResolver = new PlanApprovalResolver();
  private readonly approvalTimeouts = new Map<string, NodeJS.Timeout>();

  constructor() {
    this.taskState = new TaskState();
    // Use an empty function for now, will be updated via setEventCallback if needed
    // or through the messageHandler being hooked into the actual webview sender.
    this.messageHandler = new MessageStateHandler(
        this.taskState,
        () => {}, // Placeholder, set later
    );
  }

  async initialize(): Promise<void> {
    log.info('Initialized with new Task architecture');
  }

  dispose(): void {
    if (this.currentTask) {
      this.currentTask.cancel();
    }
    for (const timeout of this.approvalTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.approvalTimeouts.clear();
  }

  /**
   * Add a listener for planning events
   */
  public addListener(listener: (event: PlanEvent) => void): void {
    this.messageHandler.on('planEvent', listener);
  }

  /**
   * Remove a listener
   */
  public removeListener(listener: (event: PlanEvent) => void): void {
    this.messageHandler.off('planEvent', listener);
  }

  public setPersistPlanFn(fn: (plan: ExecutionPlan) => Promise<void>) {
    this.persistPlanFn = fn;
  }

  /**
   * Set callback for events (Legacy compatibility)
   */
  public setEventCallback(callback: (event: PlanEvent) => void): void {
    this.addListener(callback);
  }

  // ==================== PLAN MANAGEMENT ====================

  /**
   * Create a structured execution plan
   */
  createPlan(params: CreatePlanParams): ExecutionPlan {
    const createdAt = Date.now();
    const usedStepIds = new Set<string>();
    const plan: ExecutionPlan = {
      schemaVersion: PlanningManager.PLAN_SCHEMA_VERSION,
      id: `plan_${Date.now()}`,
      goal: params.goal,
      steps: (params.steps || []).map((s, i) => ({
        ...s,
        id: this.ensureUniqueStepId(s.id, s.description, i, usedStepIds),
        status: 'pending' as const
      })),
      status: 'created' as const,
      createdAt,
      currentStepIndex: 0,
      totalSteps: params.steps?.length || 0,
      completedSteps: 0,
      failedSteps: 0,
      pendingApproval: null
    };

    this.taskState.setPlan(plan);

    return plan;
  }

  /**
   * Get a plan by ID
   */
  getPlan(planId: string): ExecutionPlan | undefined {
    const plan = this.taskState.getPlan();
    return plan?.id === planId ? plan : undefined;
  }

  /**
   * Get all plans (Legacy support)
   */
  getAllPlans(): ExecutionPlan[] {
    const plan = this.taskState.getPlan();
    return plan ? [plan] : [];
  }

  /**
   * Update plan status
   */
  async updatePlanStatus(planId: string, status: string): Promise<void> {
    this.assertValidStatusTransition(planId, status as PlanLifecycleStatus);
    await this.messageHandler.updatePlanStatus(planId, status);
  }

  /**
   * Update step status
   */
  async updateStepStatus(planId: string, stepId: string, status: string, result?: unknown, error?: string): Promise<void> {
    const normalizedStatus = this.normalizeTaskStatus(status);
    await this.messageHandler.updateStepStatus(planId, stepId, normalizedStatus, result, error);
  }

  /**
   * Starte die automatische Ausführung eines Plans
   */
  async startPlanExecution(planId: string): Promise<PlanExecutionResult> {
    const plan = this.taskState.getPlan();
    if (!plan || plan.id !== planId) throw new Error('Plan not found');

    log.info(`Launching Task for plan ${planId}`);
    
    this.currentTask = new Task(this.taskState, this.messageHandler, {
        toolManager: this.toolManager,
        checkpointManager: null, // Hook up via DI if needed
        persistPlan: async (p) => {
            if (this.persistPlanFn) await this.persistPlanFn(p);
        }
    });

    await this.currentTask.execute();
    
    const finalPlan = this.taskState.getPlan()!;
    return {
      success: finalPlan.status === 'completed',
      plan: finalPlan,
      completedSteps: finalPlan.steps.filter(s => s.status === 'completed')
    };
  }

  // ==================== LEGACY COMPATIBILITY ====================

  public shouldUseIterativePlanning(goal: string): boolean {
    return false; // Iterative planning heuristic disabled to prevent unintended search loops
  }

  public async executeGoalIteratively(goal: string, tools: any, llmProvider: any): Promise<any> {
    const currentPlan = this.getCurrentPlan();
    if (currentPlan) {
        log.info(`Executing goal iteratively using existing plan ${currentPlan.id}`);
        return this.startPlanExecution(currentPlan.id);
    }
    
    log.error('executeGoalIteratively called but no plan exists');
    return { success: false, message: 'No plan found to execute' };
  }

  public getPlanManager(): any {
    return this; // Facade
  }

  public handoverToCoder(planId: string, message: string) {
      this.messageHandler.handoverToCoder(planId, message);
  }

  public async announcePlanCreated(plan: ExecutionPlan): Promise<void> {
      await this.messageHandler.announcePlanCreated(plan);
  }

  // ==================== LEGACY STUBS ====================

  public async loadPlanFromMarkdown(planId: string): Promise<ExecutionPlan | undefined> {
      log.info(`loadPlanFromMarkdown called for ${planId} - Stubbed for now`);
      return this.getPlan(planId);
  }

  public setCurrentPlanId(planId: string): void {
      log.info(`setCurrentPlanId called for ${planId} - Stubbed for now`);
  }

  public getCurrentPlanId(): string | undefined {
    return this.taskState.getPlan()?.id;
  }

  public getCurrentPlan(): ExecutionPlan | undefined {
      const plan = this.taskState.getPlan();
      return plan || undefined;
  }

  public async requestPlanApproval(planId: string): Promise<PlanApprovalRequestState> {
    await this.assertPlanExists(planId);
    await this.updatePlanStatus(planId, 'awaiting_approval');
    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found.`);
    }
    const pendingApproval = this.approvalResolver.createRequest(
      plan,
      Date.now(),
      PlanningManager.DEFAULT_APPROVAL_TIMEOUT_MS
    );
    await this.setPendingApproval(planId, pendingApproval);
    this.schedulePlanApprovalTimeout(planId, pendingApproval);
    const updatedPlan = this.getPlan(planId);
    if (!updatedPlan) {
      throw new Error(`Plan ${planId} not found.`);
    }
    await this.messageHandler.announcePlanApprovalRequested(updatedPlan, pendingApproval);
    return pendingApproval;
  }

  public async resolvePlanApproval(
    planId: string,
    decision: 'approved' | 'rejected' | 'timeout',
    reason?: string,
    source: 'user' | 'policy' | 'system' = 'system',
    options?: { approvalRequestId?: string }
  ): Promise<PlanApprovalResolutionResult> {
    await this.assertPlanExists(planId);
    const currentPlan = this.getPlan(planId);
    if (!currentPlan) {
      throw new Error(`Plan ${planId} not found.`);
    }

    const resolution = this.approvalResolver.resolve({
      plan: currentPlan,
      decision,
      source,
      approvalRequestId: options?.approvalRequestId
    });

    if (resolution.resolution !== 'applied') {
      const stablePlan = this.getPlan(planId);
      if (stablePlan) {
        await this.messageHandler.announcePlanApprovalResolved({
          plan: stablePlan,
          status: decision,
          reason: reason || resolution.reasonCode,
          reasonCode: resolution.reasonCode,
          source,
          resolution: resolution.resolution,
          approvalRequestId: resolution.approvalRequestId,
          expectedApprovalRequestId: resolution.expectedApprovalRequestId
        });
      }
      return resolution;
    }

    this.clearPlanApprovalTimeout(planId);

    if (decision === 'approved') {
      await this.updatePlanStatus(planId, 'approved');
    } else if (decision === 'rejected') {
      await this.updatePlanStatus(planId, 'rejected');
    } else {
      await this.updatePlanStatus(planId, 'awaiting_approval');
    }
    if (decision !== 'timeout') {
      await this.clearPendingApproval(planId);
    }

    const plan = this.getPlan(planId);
    if (!plan) return resolution;
    await this.messageHandler.announcePlanApprovalResolved({
      plan,
      status: decision,
      reason: reason || resolution.reasonCode,
      reasonCode: resolution.reasonCode,
      source,
      resolution: resolution.resolution,
      approvalRequestId: resolution.approvalRequestId,
      expectedApprovalRequestId: resolution.expectedApprovalRequestId
    });
    return resolution;
  }

  public async beginExecution(planId: string): Promise<void> {
    await this.assertPlanExists(planId);
    const plan = this.getPlan(planId);
    if (!plan) return;
    if (plan.status === 'executing' || plan.status === 'completed' || plan.status === 'failed') return;

    if (plan.status === 'handed_over' || plan.status === 'approved' || plan.status === 'pending') {
      await this.updatePlanStatus(planId, 'executing');
    }
  }

  public async applyStepUpdates(
    planId: string,
    updates: PlanStepStatusUpdate[]
  ): Promise<{
    success: boolean;
    planId: string;
    updated: Array<{ stepId: string; status: TaskStatus }>;
    skipped: Array<{ stepId: string; reason: string }>;
    planStatus: PlanLifecycleStatus;
  }> {
    await this.assertPlanExists(planId);
    const plan = this.getPlan(planId);
    if (!plan) {
      return {
        success: false,
        planId,
        updated: [],
        skipped: [],
        planStatus: 'failed'
      };
    }

    if (
      plan.status === 'approved' ||
      plan.status === 'handed_over' ||
      plan.status === 'pending'
    ) {
      await this.beginExecution(planId);
    }

    const updated: Array<{ stepId: string; status: TaskStatus }> = [];
    const skipped: Array<{ stepId: string; reason: string }> = [];

    for (const update of updates) {
      const stepId = String(update?.stepId || '').trim();
      if (!stepId) {
        skipped.push({ stepId: '', reason: 'missing_step_id' });
        continue;
      }

      const step = plan.steps.find((item) => item.id === stepId);
      if (!step) {
        skipped.push({ stepId, reason: 'step_not_found' });
        continue;
      }

      const normalizedStatus = this.normalizeTaskStatus(update.status);
      const currentStatus = this.normalizeTaskStatus(step.status);

      if (currentStatus === normalizedStatus) {
        skipped.push({ stepId, reason: 'idempotent_noop' });
        continue;
      }

      await this.updateStepStatus(planId, stepId, normalizedStatus, update.result, update.reason);
      updated.push({ stepId, status: normalizedStatus });
    }

    const refreshedPlan = this.getPlan(planId);
    if (refreshedPlan) {
      const statuses = refreshedPlan.steps.map((step) => this.normalizeTaskStatus(step.status));
      const hasPending = statuses.some((status) => status === 'pending' || status === 'in_progress');
      const hasFailed = statuses.some((status) => status === 'failed');
      const allDone = statuses.every((status) => status === 'completed' || status === 'skipped');

      if (allDone && refreshedPlan.status === 'executing') {
        await this.updatePlanStatus(planId, 'completed');
      } else if (hasFailed && !hasPending && refreshedPlan.status === 'executing') {
        await this.updatePlanStatus(planId, 'failed');
      }
    }

    return {
      success: true,
      planId,
      updated,
      skipped,
      planStatus: this.getPlan(planId)?.status || 'failed'
    };
  }

  public async markHandedOver(planId: string): Promise<void> {
    await this.assertPlanExists(planId);
    await this.updatePlanStatus(planId, 'handed_over');
  }

  public canHandover(planId: string): { ok: boolean; reason?: string } {
    const plan = this.getPlan(planId);
    if (!plan) {
      return { ok: false, reason: 'Plan not found.' };
    }
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      return { ok: false, reason: 'Plan contains no steps.' };
    }
    if (plan.status !== 'approved') {
      return { ok: false, reason: `Plan must be approved before handover (current: ${plan.status}).` };
    }
    if (plan.pendingApproval?.approvalRequestId) {
      return { ok: false, reason: `Plan still has pending approval request (${plan.pendingApproval.approvalRequestId}).` };
    }
    return { ok: true };
  }

  public async retryStep(planId: string, stepId: string): Promise<void> {
      log.info(`retryStep called for ${planId}/${stepId} - Legacy behavior: reset status to pending`);
      await this.updateStepStatus(planId, stepId, 'pending');
  }

  public async skipStep(planId: string, stepId: string): Promise<void> {
      log.info(`skipStep called for ${planId}/${stepId}`);
      await this.updateStepStatus(planId, stepId, 'skipped');
  }

  public async abortPlan(planId: string): Promise<void> {
      log.info(`abortPlan called for ${planId}`);
      if (this.currentTask) {
          this.currentTask.cancel();
      }
      await this.updatePlanStatus(planId, 'paused');
  }

  public async startAutoExecution(planId: string): Promise<void> {
      await this.startPlanExecution(planId);
  }

  // ==================== TOOL INTEGRATION ====================

  setToolManager(toolManager: ToolManager): void {
    this.toolManager = toolManager;
  }

  async executeToolInPlan(toolName: string, params: Record<string, unknown>, planId?: string): Promise<unknown> {
    return await this.toolManager.executeTool(toolName, params);
  }

  public getTaskState(): TaskState {
      return this.taskState;
  }

  private async assertPlanExists(planId: string): Promise<void> {
    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found.`);
    }
  }

  private assertValidStatusTransition(planId: string, nextStatus: PlanLifecycleStatus): void {
    const plan = this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found.`);
    }
    const currentStatus = plan.status;
    if (currentStatus === nextStatus) {
      return;
    }
    const allowed = PlanningManager.PLAN_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`Invalid plan status transition: ${currentStatus} -> ${nextStatus}`);
    }
  }

  private createStableStepId(description: string, index: number): string {
    const normalized = String(description || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    const suffix = normalized || `step-${index + 1}`;
    return `step-${index + 1}-${suffix}`;
  }

  private ensureUniqueStepId(
    requestedId: string | undefined,
    description: string,
    index: number,
    usedIds: Set<string>
  ): string {
    const normalizedRequested = String(requestedId || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-');
    const base = normalizedRequested || this.createStableStepId(description, index);
    let candidate = base;
    let counter = 1;
    while (usedIds.has(candidate)) {
      counter += 1;
      candidate = `${base}-${counter}`;
    }
    usedIds.add(candidate);
    return candidate;
  }

  private async setPendingApproval(planId: string, pendingApproval: PlanApprovalRequestState | null): Promise<void> {
    await this.taskState.update((state) => {
      if (state.plan && state.plan.id === planId) {
        state.plan.pendingApproval = pendingApproval;
      }
    });
  }

  private async clearPendingApproval(planId: string): Promise<void> {
    await this.setPendingApproval(planId, null);
  }

  private schedulePlanApprovalTimeout(planId: string, pendingApproval: PlanApprovalRequestState): void {
    this.clearPlanApprovalTimeout(planId);
    const now = Date.now();
    const delayMs = Math.max(0, pendingApproval.expiresAt - now);
    const timeout = setTimeout(() => {
      void this.resolvePlanApproval(
        planId,
        'timeout',
        'approval_timeout',
        'system',
        { approvalRequestId: pendingApproval.approvalRequestId }
      );
    }, delayMs);
    this.approvalTimeouts.set(planId, timeout);
  }

  private clearPlanApprovalTimeout(planId: string): void {
    const existing = this.approvalTimeouts.get(planId);
    if (!existing) return;
    clearTimeout(existing);
    this.approvalTimeouts.delete(planId);
  }

  private normalizeTaskStatus(status: string): TaskStatus {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'in_progress') return 'in_progress';
    if (normalized === 'in-progress') return 'in_progress';
    if (normalized === 'completed') return 'completed';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'skipped') return 'skipped';
    return 'pending';
  }

  public getMessageHandler(): MessageStateHandler {
    return this.messageHandler;
  }

  public setMessageHandler(handler: MessageStateHandler) {
      this.messageHandler = handler;
  }
}
