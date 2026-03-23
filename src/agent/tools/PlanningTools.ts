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
    return {
      success: true,
      message: `✅ MODE SWITCH SUCCESSFUL

You are now in CODE MODE. The plan from the Architect is preserved in the conversation history above.

CRITICAL: You must now IMPLEMENT the plan step by step.

IMMEDIATE ACTIONS:
1. Review the plan in the conversation history
2. Start with Step 1 of the plan
3. Use safe_edit_file or write_file to implement
4. Call verify_and_auto_fix after each file change

DO NOT:
- Ask for clarification
- Create a new plan
- Wait for user input

BEGIN IMPLEMENTATION NOW.`,
      shouldAutoContinue: true,
      requestedMode: 'code',
      continuationPrompt: 'Now implement the plan step by step. Start with step 1.'
    };
  }
}
