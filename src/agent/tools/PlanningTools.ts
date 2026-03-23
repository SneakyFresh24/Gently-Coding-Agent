// =====================================================
// PlanningTools.ts – FINAL VERSION (Bereich 1)
// =====================================================

import { PlanningManager } from '../agentManager/PlanningManager';
import { TerminalManager } from '../../terminal/TerminalManager';
import { ToolRegistry } from './ToolRegistry';
import { LogService } from '../../services/LogService';

const log = new LogService('PlanningTools');

interface CreatePlanFileHint {
  path: string;
  purpose: string;
  type: 'html' | 'css' | 'js' | 'ts' | 'py' | 'rust' | 'java' | 'json' | 'markdown' | 'other';
  estimated_lines?: number;
}

interface CreatePlanInputStep {
  description: string;
  tool: string;
  parameters: Record<string, unknown>;
  dependencies?: string[];
}

interface CreatePlanInput {
  goal: string;
  steps: CreatePlanInputStep[];
  files?: CreatePlanFileHint[];
}

export class PlanningTools {
  constructor(
    private planningManager: PlanningManager,
    _terminalManager: TerminalManager | null,
    private toolRegistry?: any,
    _modeProvider?: () => string | undefined
  ) { }

  registerTools(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    registry.register('create_plan', this.createPlan.bind(this));
    registry.register('handover_to_coder', this.handoverToCoder.bind(this));
  }

  private async createPlan(params: CreatePlanInput): Promise<any> {
    const goal = (params?.goal || '').trim();
    const steps = Array.isArray(params?.steps) ? params.steps : [];
    if (!goal) {
      return {
        success: false,
        error: 'create_plan requires a non-empty "goal".'
      };
    }

    if (steps.length === 0) {
      return {
        success: false,
        error: 'create_plan requires at least one step in "steps".'
      };
    }

    const plan = this.planningManager.createPlan({
      goal,
      steps: steps.map((step) => ({
        description: step.description,
        tool: step.tool,
        parameters: step.parameters || {},
        dependencies: step.dependencies
      }))
    });

    await this.planningManager.announcePlanCreated(plan);

    const fileHints = Array.isArray(params.files) ? params.files : [];
    return {
      success: true,
      planId: plan.id,
      message: `Plan created with ${plan.steps.length} steps.`,
      plan,
      files: fileHints
    };
  }

  private async handoverToCoder(params: { message: string }): Promise<any> {
    const currentPlan = this.planningManager.getCurrentPlan();
    if (!currentPlan || !currentPlan.steps || currentPlan.steps.length === 0) {
      return {
        success: false,
        error: 'No active plan found. Create a plan with create_plan before handover_to_coder.'
      };
    }

    log.info(`Handover to coder initiated with message: ${params.message}`);
    this.planningManager.handoverToCoder(currentPlan.id, params.message || 'Architect has finished planning.');
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
