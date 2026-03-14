import { ExecutionPlan, CreatePlanParams, TaskStatus, PlanEvent } from './types';
import { PlanPersistenceService } from './PlanPersistenceService';
import { PlanStateManager } from './PlanStateManager';
import { PlanValidator } from './PlanValidator';
import { PlanExecutionService } from './PlanExecutionService';
import { PlanFactory } from './PlanFactory';
import { PlanningHeuristics } from './PlanningHeuristics';
import { LogService } from '../../services/LogService';
import { AgentTool } from '../agentManager/AgentManager';
import { OpenRouterService } from '../../services/OpenRouterService';

const log = new LogService('PlanManager');

export interface IToolManager {
  executeTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface ICheckpointManager {
  createCheckpointAfterStep(planId: string, stepId: string, result: unknown): Promise<void>;
}

/**
 * Facade for plan management and execution.
 */
export class PlanManager {
  private state = new PlanStateManager();
  private validator = new PlanValidator();
  private persistence = new PlanPersistenceService();
  private executor: PlanExecutionService;

  private toolManager: IToolManager | null = null;
  private checkpointManager: ICheckpointManager | null = null;

  private eventCallback?: (event: PlanEvent) => void;

  constructor() {
    this.executor = new PlanExecutionService(this.state, this.validator, this.persistence);
    
    // Wire up external file changes to internal state
    this.persistence.onPlanChanged((planId, updates) => {
      this.handleExternalPlanChange(planId, updates);
    });
  }

  setEventCallback(cb: (event: PlanEvent) => void) {
    this.eventCallback = cb;
    this.executor.setEventCallback(cb);  // Forward an executor!
  }

  setToolManager(tm: IToolManager) { this.toolManager = tm; }
  setCheckpointManager(cm: ICheckpointManager) { this.checkpointManager = cm; }

  getCurrentPlanId() { return this.state.getCurrentPlanId(); }
  setCurrentPlanId(id: string | null) { this.state.setCurrentPlanId(id); }

  createPlan(params: CreatePlanParams): ExecutionPlan {
    const plan = PlanFactory.createPlan(params);
    this.state.addPlan(plan);
    this.validator.validate(plan);
    this.persistence.persistPlan(plan);
    // Auto-execution removed — caller (PlanningTools) decides based on mode
    return plan;
  }

  getPlan(id: string) { return this.state.getPlan(id); }
  getCurrentPlan() { return this.state.getCurrentPlan(); }
  getAllPlans() { return this.state.getAllPlans(); }

  getNextStep(planId: string) {
    // We need to expose this if it's used by PlanningManager
    return this.executor.getNextStep(planId);
  }

  getPlanProgress(planId: string) {
    const plan = this.getPlan(planId);
    if (!plan) return { completed: 0, total: 0, percentage: 0 };
    const completed = plan.completedSteps;
    const total = plan.totalSteps;
    return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
  }

  updateStepStatus(pid: string, sid: string, s: TaskStatus, res?: unknown, err?: string) {
    this.state.updateStepStatus(pid, sid, s, res, err);
    this.validator.validate(this.state.getPlan(pid)!);
    this.persistence.persistPlan(this.state.getPlan(pid)!);
  }

  updatePlanStatus(pid: string, s: ExecutionPlan['status']) {
    this.state.updatePlanStatus(pid, s);
    this.persistence.persistPlan(this.state.getPlan(pid)!);
  }

  async startAutoExecution(planId: string) {
    if (!this.toolManager) {
      log.error('Cannot start auto-execution: toolManager not set');
      return;
    }
    await this.executor.startAutoExecution(planId, this.toolManager, this.checkpointManager);
  }

  markStepCompleted(stepId: string, result?: unknown) {
    const cpId = this.state.getCurrentPlanId();
    if (cpId) this.updateStepStatus(cpId, stepId, 'completed', result);
  }

  retryStep(pid: string, sid: string) {
    const plan = this.state.getPlan(pid);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === sid);
    if (step) {
      step.status = 'pending';
      step.result = undefined;
      step.error = undefined;
      if (['failed', 'completed'].includes(plan.status)) plan.status = 'executing';
      this.persistence.persistPlan(plan);
    }
  }

  skipStep(pid: string, sid: string) {
    const plan = this.state.getPlan(pid);
    if (!plan) return;
    const step = plan.steps.find(s => s.id === sid);
    if (step) {
      step.status = 'skipped';
      this.validator.validate(plan);
      this.persistence.persistPlan(plan);
    }
  }

  abortPlan(pid: string) {
    this.state.updatePlanStatus(pid, 'failed');
    if (this.state.getCurrentPlanId() === pid) this.state.setCurrentPlanId(null);
  }

  clearPlans() { this.state.clear(); }

  async loadPlanFromMarkdown(planId: string): Promise<ExecutionPlan | null> {
    const plan = await this.persistence.loadPlan(planId);
    if (plan) this.state.addPlan(plan);
    return plan;
  }

  shouldUseIterativePlanning(goal: string): boolean {
    return PlanningHeuristics.shouldUseIterativePlanning(goal);
  }

  /**
   * Executes a high-level goal using an iterative planning approach.
   * This is recommended for complex tasks where a traditional static plan
   * might be too rigid or difficult to generate upfront.
   * 
   * @param goal The goal description to achieve.
   * @param tools A map of available tools.
   * @param provider The LLM provider for decision making.
   * @param onEvent Optional callback for execution events.
   */
  private handleExternalPlanChange(planId: string, updates: Map<string, TaskStatus>) {
    const plan = this.state.getPlan(planId);
    if (!plan) return;

    log.info(`Syncing external changes for plan ${planId}`);
    let changed = false;

    for (const [stepId, status] of updates.entries()) {
      const step = plan.steps.find(s => s.id === stepId);
      if (step && step.status !== status) {
        log.debug(`External update: Step ${stepId} -> ${status}`);
        step.status = status;
        changed = true;
      }
    }

    if (changed) {
      // Re-calculate stats and notify
      this.state.updatePlanStatus(planId, plan.status); // Triggers index/stats update in some systems, but here we just need to emit
      
      if (this.eventCallback) {
        this.eventCallback({
          type: 'planUpdated',
          planId,
          plan: this.state.getPlan(planId)
        });
      }
    }
  }

  async executeGoalIteratively(goal: string, tools: Map<string, AgentTool>, provider: OpenRouterService, onEvent?: (e: PlanEvent) => void) {
    return this.executor.executeGoalIteratively(goal, tools, provider, onEvent);
  }
}
