// =====================================================
// PlanningManager - Refactored Planning and Execution
// =====================================================

import {
  PlanManager,
  ExecutionPlan,
  CreatePlanParams,
  PlanExecutionResult,
  PlanStep,
  PlanEvent
} from '../planning';
import { OpenRouterService } from '../../services/OpenRouterService';
import { ToolManager } from './ToolManager';
import { IAgentService } from './interfaces';

export class PlanningManager implements IAgentService {
  // Core planning components
  private planManager: PlanManager;
  private toolManager: ToolManager;

  // Configuration
  private debug: boolean = false;
  private eventCallback?: (event: PlanEvent) => void;
  private listeners: Set<(event: PlanEvent) => void> = new Set();

  constructor(
    planManager: PlanManager,
    toolManager: ToolManager
  ) {
    this.planManager = planManager;
    this.toolManager = toolManager;
  }

  async initialize(): Promise<void> {
    try {
      // Initialize planning components if needed
      if (this.debug) {
        console.log('[PlanningManager] Initialized successfully');
      }
    } catch (error) {
      console.error('[PlanningManager] Initialization failed:', error);
      throw error;
    }
  }

  dispose(): void {
    // Clean up planning components
    if (this.debug) {
      console.log('[PlanningManager] Disposed successfully');
    }
    this.listeners.clear();
  }

  /**
   * Add a listener for planning events
   */
  public addListener(listener: (event: PlanEvent) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   */
  public removeListener(listener: (event: PlanEvent) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Forward events to all listeners
   */
  private emit(event: PlanEvent): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[PlanningManager] Error in listener:', error);
      }
    });
  }

  // ==================== PLAN MANAGEMENT ====================

  /**
   * Create a structured execution plan
   */
  createPlan(params: CreatePlanParams): ExecutionPlan {
    return this.planManager.createPlan(params);
  }

  /**
   * Get a plan by ID
   */
  getPlan(planId: string): ExecutionPlan | undefined {
    return this.planManager.getPlan(planId);
  }

  /**
   * Get all plans
   */
  getAllPlans(): ExecutionPlan[] {
    return this.planManager.getAllPlans();
  }

  /**
   * Update plan status
   */
  updatePlanStatus(planId: string, status: string): void {
    this.planManager.updatePlanStatus(planId, status as any);

    // Forward event
    this.emit({
      type: 'planStatusUpdate',
      planId,
      status
    });
  }

  /**
   * Get next step in a plan
   */
  getNextStep(planId: string): PlanStep | null {
    return this.planManager.getNextStep(planId);
  }

  /**
   * Update step status
   */
  updateStepStatus(planId: string, stepId: string, status: string, result?: unknown, error?: string): void {
    this.planManager.updateStepStatus(planId, stepId, status as any, result, error);

    // Forward event
    this.emit({
      type: 'stepStatusUpdate',
      planId,
      stepId,
      status,
      result,
      error
    });

    // Emit 'planStepCompleted' event for better UI synchronization
    if (status === 'completed') {
      this.emit({
        type: 'planStepCompleted',
        planId,
        stepId,
        result
      });
    }

    // Always emit a global `planUpdated` with the latest plan state to refresh TaskView
    const updatedPlan = this.planManager.getPlan(planId);
    if (updatedPlan) {
      this.emit({
        type: 'planUpdated',
        plan: updatedPlan
      } as any);
    }
  }

  /**
   * Get plan progress
   */
  getPlanProgress(planId: string): { completed: number; total: number; percentage: number } {
    return this.planManager.getPlanProgress(planId);
  }

  /**
   * Starte die automatische Ausführung eines Plans
   */
  async startPlanExecution(planId: string): Promise<PlanExecutionResult> {
    const plan = this.planManager.getPlan(planId);
    if (!plan) throw new Error('Plan not found');

    // Inject ToolManager so PlanManager can execute tools
    this.planManager.setToolManager(this.toolManager);

    await this.planManager.startAutoExecution(planId);

    const updatedPlan = this.planManager.getPlan(planId)!;

    this.emit({
      type: 'planStatusUpdate',
      planId,
      status: updatedPlan.status,
      completedSteps: updatedPlan.completedSteps
    });

    return {
      success: updatedPlan.status === 'completed',
      plan: updatedPlan,
      completedSteps: updatedPlan.steps.filter(s => s.status === 'completed')
    };
  }

  // ==================== PLAN EXECUTION ====================



  /**
   * Cancel plan execution
   */
  cancelPlan(planId: string): void {
    // Note: PlanManager doesn't have cancelPlan method
    // For now, we'll update the status to failed
    this.planManager.updatePlanStatus(planId, 'failed');
    return;
  }

  // ==================== ITERATIVE PLANNING ====================

  /**
   * Check if goal requires iterative planning
   */
  shouldUseIterativePlanning(goal: string): boolean {
    return this.planManager.shouldUseIterativePlanning(goal);
  }

  /**
   * Execute goal iteratively
   */
  async executeGoalIteratively(goal: string, tools: Map<string, any>, llmProvider: OpenRouterService): Promise<unknown> {
    // Falls wir ein iteratives Ziel haben, erstellen wir erst einen Plan und führen ihn dann aus
    const params: CreatePlanParams = {
      goal,
      steps: [
        {
          description: `Analyze and solve the goal: ${goal}`,
          tool: 'analyze_project_structure', // Fallback tool
          parameters: {},
          dependencies: []
        }
      ]
    };

    const plan = this.planManager.createPlan(params);
    this.planManager.setToolManager(this.toolManager);

    return await this.planManager.startAutoExecution(plan.id);
  }

  /**
   * Set event callback for iterative planning
   */
  setEventCallback(callback: (event: PlanEvent) => void): void {
    this.eventCallback = callback;
    this.planManager.setEventCallback(callback); 
  }

  // ==================== TOOL INTEGRATION ====================

  /**
   * Set tool manager for plan execution
   */
  setToolManager(toolManager: ToolManager): void {
    this.toolManager = toolManager;
  }

  /**
   * Execute tool within a plan context
   */
  async executeToolInPlan(toolName: string, params: Record<string, unknown>, planId?: string): Promise<unknown> {
    try {
      // Validate tool exists
      if (!this.toolManager.hasTool(toolName)) {
        throw new Error(`Tool not found: ${toolName}`);
      }

      // Execute tool
      const result = await this.toolManager.executeTool(toolName, params);

      if (this.debug) {
        console.log(`[PlanningManager] Tool ${toolName} executed successfully in plan ${planId}`);
      }

      return result;
    } catch (error) {
      console.error(`[PlanningManager] Error executing tool ${toolName} in plan ${planId}:`, error);
      throw error;
    }
  }

  // ==================== VALIDATION AND ANALYSIS ====================

  /**
   * Validate plan structure
   */
  validatePlan(params: CreatePlanParams): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check goal
    if (!params.goal || params.goal.trim().length === 0) {
      errors.push('Goal is required');
    }

    // Check steps
    if (!params.steps || !Array.isArray(params.steps)) {
      errors.push('Steps array is required');
    } else if (params.steps.length === 0) {
      errors.push('At least one step is required');
    } else {
      // Validate each step
      params.steps.forEach((step, index) => {
        if (!step.description || step.description.trim().length === 0) {
          errors.push(`Step ${index + 1}: Description is required`);
        }
        if (!step.tool || step.tool.trim().length === 0) {
          errors.push(`Step ${index + 1}: Tool is required`);
        }
        if (!step.parameters || typeof step.parameters !== 'object') {
          errors.push(`Step ${index + 1}: Parameters object is required`);
        }
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Analyze plan dependencies
   */
  analyzePlanDependencies(params: CreatePlanParams): { valid: boolean; cycles: string[][]; errors: string[] } {
    const errors: string[] = [];
    const cycles: string[][] = [];
    const dependencies = new Map<string, string[]>();

    // Build dependency graph
    params.steps.forEach((step, index) => {
      const stepId = `step-${index + 1}`;
      dependencies.set(stepId, step.dependencies || []);
    });

    // Check for cycles using DFS
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (node: string, path: string[] = []): boolean => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart);
        cycles.push(cycle);
        return true;
      }

      if (visited.has(node)) {
        return false; // Already processed, no cycle
      }

      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = dependencies.get(node) || [];
      for (const dep of deps) {
        if (hasCycle(dep, [...path])) {
          recursionStack.delete(node);
          return true;
        }
      }

      recursionStack.delete(node);
      path.pop();
      return false;
    };

    // Check all nodes
    for (const stepId of dependencies.keys()) {
      if (hasCycle(stepId)) {
        errors.push(`Circular dependency detected involving step ${stepId}`);
      }
    }

    // Validate dependency references
    for (const [stepId, deps] of dependencies.entries()) {
      for (const dep of deps) {
        if (!dependencies.has(dep)) {
          errors.push(`Step ${stepId} references non-existent dependency: ${dep}`);
        }
      }
    }

    return { valid: errors.length === 0, cycles, errors };
  }

  /**
   * Optimize plan execution order
   */
  optimizePlan(params: CreatePlanParams): CreatePlanParams {
    // Create a copy to avoid mutating the original
    const optimizedParams = { ...params, steps: [...params.steps] };

    // Build dependency graph
    const dependencies = new Map<string, string[]>();
    const stepMap = new Map<string, any>();

    optimizedParams.steps.forEach((step, index) => {
      const stepId = `step-${index + 1}`;
      dependencies.set(stepId, step.dependencies || []);
      stepMap.set(stepId, { ...step, id: stepId });
    });

    // Topological sort to get optimal execution order
    const visited = new Set<string>();
    const tempVisited = new Set<string>();
    const result: string[] = [];

    const visit = (node: string): boolean => {
      if (tempVisited.has(node)) {
        // Circular dependency
        return false;
      }

      if (!visited.has(node)) {
        tempVisited.add(node);

        const deps = dependencies.get(node) || [];
        for (const dep of deps) {
          if (!visit(dep)) {
            return false;
          }
        }

        tempVisited.delete(node);
        visited.add(node);
        result.unshift(node);
      }

      return true;
    };

    // Perform topological sort
    for (const stepId of dependencies.keys()) {
      if (!visit(stepId)) {
        // Circular dependency detected, keep original order
        if (this.debug) {
          console.warn('[PlanningManager] Circular dependencies detected, keeping original order');
        }
        return optimizedParams;
      }
    }

    // Reorder steps based on topological sort
    const orderedSteps = result.map((stepId, index) => ({
      ...stepMap.get(stepId),
      id: `step-${index + 1}`,
      dependencies: stepMap.get(stepId).dependencies
    }));

    optimizedParams.steps = orderedSteps;

    if (this.debug) {
      console.log('[PlanningManager] Plan optimized:', {
        originalOrder: params.steps.map((step, i) => `step-${i + 1}`),
        optimizedOrder: result
      });
    }

    return optimizedParams;
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Enable/disable debug logging
   */
  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  /**
   * Get plan statistics
   */
  getPlanStats(): { total: number; completed: number; failed: number; executing: number } {
    const plans = this.getAllPlans();

    return {
      total: plans.length,
      completed: plans.filter(p => p.status === 'completed').length,
      failed: plans.filter(p => p.status === 'failed').length,
      executing: plans.filter(p => p.status === 'executing').length
    };
  }

  /**
   * Clear all plans (for testing)
   */
  clearPlans(): void {
    this.planManager.clearPlans();
  }

  /**
   * Get plan manager instance
   */
  getPlanManager(): PlanManager {
    return this.planManager;
  }
}