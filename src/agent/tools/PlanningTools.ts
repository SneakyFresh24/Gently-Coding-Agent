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
    registry.register('handover_to_coder', this.handoverToCoder.bind(this));
  }

  private async handoverToCoder(params: { message: string }): Promise<any> {
    log.info(`Handover to coder initiated with message: ${params.message}`);
    this.planningManager.handoverToCoder('text-plan', params.message || 'Architect has finished planning.');
    return { success: true, message: 'Handover to Code mode initiated. Plan preserved in chat.' };
  }
}
