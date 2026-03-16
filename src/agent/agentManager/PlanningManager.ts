// =====================================================
// PlanningManager - New Task-Oriented Architecture
// =====================================================

import {
  ExecutionPlan,
  CreatePlanParams,
  PlanExecutionResult,
  PlanStep,
  PlanEvent
} from '../planning';
import { TaskState } from '../../core/task/TaskState';
import { Task } from '../../core/task/Task';
import { MessageStateHandler } from '../../core/task/MessageStateHandler';
import { ToolManager } from './ToolManager';
import { IAgentService } from './interfaces';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanningManager');

export class PlanningManager implements IAgentService {
  private toolManager!: ToolManager;
  private taskState: TaskState;
  private messageHandler: MessageStateHandler;
  private currentTask: Task | null = null;
  private persistPlanFn?: (plan: ExecutionPlan) => Promise<void>;

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
    const plan: ExecutionPlan = {
      id: `plan_${Date.now()}`,
      goal: params.goal,
      steps: (params.steps || []).map((s, i) => ({
        ...s,
        id: `step-${i + 1}`,
        status: 'pending' as const
      })),
      status: 'pending' as const,
      createdAt: Date.now(),
      currentStepIndex: 0,
      totalSteps: params.steps?.length || 0,
      completedSteps: 0,
      failedSteps: 0
    };

    this.taskState.update((s) => {
        s.plan = plan;
    });

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
    await this.messageHandler.updatePlanStatus(planId, status);
  }

  /**
   * Update step status
   */
  async updateStepStatus(planId: string, stepId: string, status: string, result?: unknown, error?: string): Promise<void> {
    await this.messageHandler.updateStepStatus(planId, stepId, status as any, result, error);
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
    return goal.length > 50; // Simple heuristic
  }

  public async executeGoalIteratively(goal: string, tools: any, llmProvider: any): Promise<any> {
    const plan = this.createPlan({ goal, steps: [{ description: 'Auto-step', tool: 'web_search', parameters: { query: goal } }] });
    return this.startPlanExecution(plan.id);
  }

  public getPlanManager(): any {
    return this; // Facade
  }

  public handoverToCoder(planId: string, message: string) {
      this.messageHandler.handoverToCoder(planId, message);
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

  public getMessageHandler(): MessageStateHandler {
    return this.messageHandler;
  }

  public setMessageHandler(handler: MessageStateHandler) {
      this.messageHandler = handler;
  }
}