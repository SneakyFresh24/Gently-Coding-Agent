// =====================================================
// PlanningTools.ts – FINAL VERSION (Bereich 1)
// =====================================================

import { PlanManager, CreatePlanParams, ExecutePlanParams, PlanEvent } from '../planning';
import { TerminalManager } from '../../terminal/TerminalManager';
import { ToolRegistry } from './ToolRegistry';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanningTools');

export class PlanningTools {
  constructor(
    private planManager: PlanManager,
    private terminalManager: TerminalManager | null,
    private emitEvent: (event: PlanEvent) => void,
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
      const plan = this.planManager.createPlan(params);
      log.info(`Plan created with ${plan.steps.length} steps: ${plan.id}`);

      this.emitEvent({
        type: 'planCreated',
        plan: { ...plan, phase: 'created', timestamp: Date.now() }
      });

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
      await this.planManager.startAutoExecution(plan.id);

      // Aktualisierten Status abrufen (kann undefined sein wenn Plan intern entfernt wurde)
      const completedPlan = this.planManager.getPlan(plan.id);
      const finalStatus = completedPlan?.status ?? 'completed';

      return {
        success: finalStatus === 'completed',
        planId: plan.id,
        goal: plan.goal,
        status: finalStatus,
        totalSteps: plan.totalSteps,
        message: finalStatus === 'completed' ? `Plan erfolgreich abgeschlossen.` : `Plan Ausführung beendet mit Status: ${finalStatus}`
      };
    } catch (error) {
      log.error(`Failed to create plan:`, error);
      return { success: false, message: String(error) };
    }
  }

  private async executePlan(params: ExecutePlanParams): Promise<any> {
    log.info(`Executing plan: ${params.planId}`);
    try {
      // NEU: Starte die automatische Ausführung über PlanManager
      await this.planManager.startAutoExecution(params.planId);

      const finalPlan = this.planManager.getPlan(params.planId);
      const finalStatus = finalPlan?.status ?? 'completed';
      log.info(`Plan execution finished for ${params.planId} with status: ${finalStatus}`);

      this.emitEvent({
        type: 'planStatusUpdate',
        planId: params.planId,
        status: finalStatus,
        timestamp: Date.now()
      });

      return {
        success: finalStatus === 'completed',
        planId: params.planId,
        status: finalStatus,
        completedSteps: finalPlan?.completedSteps ?? 0,
        message: finalStatus === 'completed'
          ? `✅ Plan erfolgreich abgeschlossen!`
          : `Plan beendet mit Status: ${finalStatus}`
      };
    } catch (error: any) {
      log.error(`Plan execution failed for ${params.planId}:`, error);
      this.emitEvent({
        type: 'planStatusUpdate',
        planId: params.planId,
        status: 'failed',
        error: error.message,
        timestamp: Date.now()
      });
      return { success: false, message: error.message };
    }
  }

  private async handoverToCoder(params: { planId: string; message?: string }): Promise<any> {
    log.info(`Handover to coder initiated for plan: ${params.planId}`);
    this.emitEvent({
      type: 'handover_to_coder',
      planId: params.planId,
      message: params.message || 'Architect has finished planning.',
      timestamp: Date.now()
    });
    return { success: true, message: 'Handover to Code mode initiated' };
  }
}
