// =====================================================
// PlanningTools.ts – FINAL VERSION (Bereich 1)
// =====================================================

import { PlanningManager } from '../agentManager/PlanningManager';
import { ExecutionPlan, CreatePlanParams, ExecutePlanParams, PlanEvent } from '../planning';
import { TerminalManager } from '../../terminal/TerminalManager';
import { ToolRegistry } from './ToolRegistry';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanningTools');

export class PlanningTools {
  constructor(
    private planningManager: PlanningManager,
    private terminalManager: TerminalManager | null,
    private toolRegistry?: any,
    private modeProvider?: () => string | undefined
  ) { }

  registerTools(registry: ToolRegistry): void {
    this.toolRegistry = registry;

    registry.register('create_plan', this.createPlan.bind(this));
    registry.register('execute_plan', this.executePlan.bind(this));
    registry.register('handover_to_coder', this.handoverToCoder.bind(this));
  }

  private async createPlan(params: CreatePlanParams): Promise<unknown> {
    log.info(`Creating plan for goal: ${params.goal}`);
    try {
      const plan = this.planningManager.createPlan(params);
      log.info(`Plan created with ${plan.steps.length} steps: ${plan.id}`);

      // Auf plan ausführung warten (Nur wenn NICHT im Architect-Modus)
      const currentMode = this.modeProvider?.();
      log.info(`Current mode context for plan ${plan.id}: ${currentMode}`);

      if (currentMode === 'architect') {
        log.info(`Architect mode detected - Skipping auto-execution for plan ${plan.id}. Waiting for handover.`);
        return {
          success: true,
          planId: plan.id,
          goal: plan.goal,
          status: 'pending',
          totalSteps: plan.totalSteps,
          message: `Plan erstellt. Da du im Architect-Modus bist, wurde die automatische Ausführung übersprungen. Bitte überprüfe den Plan und nutze 'handover_to_coder', wenn du bereit bist.`
        };
      }

      log.info(`Starting auto-execution for plan ${plan.id}`);
      const result = await this.planningManager.startPlanExecution(plan.id);

      return {
        success: result.success,
        planId: plan.id,
        goal: plan.goal,
        status: result.plan.status,
        totalSteps: plan.totalSteps,
        message: result.success ? `Plan erfolgreich abgeschlossen.` : `Plan Ausführung beendet mit Status: ${result.plan.status}`
      };
    } catch (error) {
      log.error(`Failed to create plan:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async executePlan(params: ExecutePlanParams): Promise<any> {
    log.info(`Executing plan: ${params.planId}`);
    try {
      const result = await this.planningManager.startPlanExecution(params.planId);
      log.info(`Plan execution finished for ${params.planId} with status: ${result.plan.status}`);

      return {
        success: result.success,
        planId: params.planId,
        status: result.plan.status,
        completedSteps: result.plan.completedSteps ?? 0,
        message: result.success
          ? `✅ Plan erfolgreich abgeschlossen!`
          : `Plan beendet mit Status: ${result.plan.status}`
      };
    } catch (error: any) {
      log.error(`Plan execution failed for ${params.planId}:`, error);
      return { success: false, message: error.message };
    }
  }

  private async handoverToCoder(params: { planId: string; message?: string }): Promise<any> {
    log.info(`Handover to coder initiated for plan: ${params.planId}`);
    this.planningManager.handoverToCoder(params.planId, params.message || 'Architect has finished planning.');
    return { success: true, message: 'Handover to Code mode initiated' };
  }
}
