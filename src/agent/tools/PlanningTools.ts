// =====================================================
// PlanningTools.ts – FINAL VERSION (Bereich 1)
// =====================================================

import { PlanningManager } from '../agentManager/PlanningManager';
import { TerminalManager } from '../../terminal/TerminalManager';
import { ToolRegistry } from './ToolRegistry';
import { LogService } from '../../services/LogService';
import * as vscode from 'vscode';

const log = new LogService('PlanningTools');

interface CreatePlanFileHint {
  path: string;
  purpose: string;
  type: 'html' | 'css' | 'js' | 'ts' | 'py' | 'rust' | 'java' | 'json' | 'markdown' | 'other';
  estimated_lines?: number;
}

interface CreatePlanInputStep {
  id?: string;
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

interface UpdatePlanStepsInput {
  planId?: string;
  updates: Array<{
    stepId: string;
    status: 'pending' | 'in_progress' | 'in-progress' | 'completed' | 'failed' | 'skipped';
    reason?: string;
    result?: unknown;
  }>;
  source?: 'architect' | 'code' | 'system' | 'user';
  timestamp?: number;
}

export class PlanningTools {
  private static readonly MAX_GOAL_LENGTH = 600;
  private static readonly MAX_STEPS = 40;
  private static readonly MAX_DESCRIPTION_LENGTH = 300;
  private static readonly MAX_DEPENDENCIES_PER_STEP = 10;
  private static readonly STEP_STATUS_SET = new Set([
    'pending',
    'in_progress',
    'in-progress',
    'completed',
    'failed',
    'skipped'
  ]);
  private static readonly TOOL_ALIAS_MAP: Record<string, string> = {
    create_file: 'write_file',
    update_file: 'safe_edit_file',
    modify_file: 'safe_edit_file'
  };

  constructor(
    private planningManager: PlanningManager,
    _terminalManager: TerminalManager | null,
    private toolRegistry?: any,
    _modeProvider?: () => string | undefined
  ) { }

  registerTools(registry: ToolRegistry): void {
    this.toolRegistry = registry;
    registry.register('create_plan', this.createPlan.bind(this));
    registry.register('update_plan_steps', this.updatePlanSteps.bind(this));
    registry.register('handover_to_coder', this.handoverToCoder.bind(this));
  }

  private async createPlan(params: CreatePlanInput): Promise<any> {
    const existingPlan = this.planningManager.getCurrentPlan();
    if (existingPlan && existingPlan.status === 'awaiting_approval' && existingPlan.pendingApproval?.approvalRequestId) {
      return {
        success: false,
        error: `Existing plan ${existingPlan.id} is still awaiting approval (request: ${existingPlan.pendingApproval.approvalRequestId}).`,
        code: 'PLAN_APPROVAL_PENDING',
        planId: existingPlan.id,
        approvalRequestId: existingPlan.pendingApproval.approvalRequestId
      };
    }

    const validation = this.validateCreatePlanInput(params);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }
    const { goal, steps } = validation;

    const plan = this.planningManager.createPlan({
      goal,
      steps: steps.map((step) => ({
        id: step.id,
        description: step.description,
        tool: step.tool,
        parameters: step.parameters || {},
        dependencies: step.dependencies
      }))
    });

    await this.planningManager.announcePlanCreated(plan);

    const requireApproval = vscode.workspace
      .getConfiguration('gently')
      .get<boolean>('planning.requireApproval', true);

    if (requireApproval) {
      await this.planningManager.requestPlanApproval(plan.id);
    } else {
      const approvalRequest = await this.planningManager.requestPlanApproval(plan.id);
      await this.planningManager.resolvePlanApproval(
        plan.id,
        'approved',
        'auto_approved_by_policy',
        'policy',
        {
          approvalRequestId: approvalRequest.approvalRequestId
        }
      );
    }

    const fileHints = Array.isArray(params.files) ? params.files : [];
    return {
      success: true,
      planId: plan.id,
      status: requireApproval ? 'awaiting_approval' : 'approved',
      message: requireApproval
        ? `Plan created with ${plan.steps.length} steps and is awaiting approval.`
        : `Plan created with ${plan.steps.length} steps and auto-approved.`,
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

    const autoApproveBeforeHandover = vscode.workspace
      .getConfiguration('gently')
      .get<boolean>('planning.autoApproveBeforeHandover', false);
    const handoverCheck = this.planningManager.canHandover(currentPlan.id);
    if (!handoverCheck.ok && autoApproveBeforeHandover) {
      let approvalRequestId = String(currentPlan.pendingApproval?.approvalRequestId || '').trim();
      if (!approvalRequestId) {
        const approvalRequest = await this.planningManager.requestPlanApproval(currentPlan.id);
        approvalRequestId = approvalRequest.approvalRequestId;
      }
      await this.planningManager.resolvePlanApproval(
        currentPlan.id,
        'approved',
        'auto_approved_for_handover',
        'policy',
        {
          approvalRequestId
        }
      );
    }

    const finalHandoverCheck = this.planningManager.canHandover(currentPlan.id);
    if (!finalHandoverCheck.ok) {
      return {
        success: false,
        error: finalHandoverCheck.reason || 'Plan must be approved before handover_to_coder.'
      };
    }

    log.info(`Handover to coder initiated with message: ${params.message}`);
    await this.planningManager.markHandedOver(currentPlan.id);
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

  private async updatePlanSteps(params: UpdatePlanStepsInput): Promise<any> {
    const rawPlanId = String(params?.planId || '').trim();
    const currentPlan = this.planningManager.getCurrentPlan();
    const planId = rawPlanId || String(currentPlan?.id || '').trim();
    if (!planId) {
      return {
        success: false,
        error: 'No active plan found. Create and approve a plan before update_plan_steps.'
      };
    }

    const plan = this.planningManager.getPlan(planId);
    if (!plan) {
      return {
        success: false,
        error: `Plan "${planId}" not found.`
      };
    }

    const rawUpdates = Array.isArray(params?.updates) ? params.updates : [];
    if (rawUpdates.length === 0) {
      return {
        success: false,
        error: 'update_plan_steps requires at least one step update in "updates".'
      };
    }

    const updates = [];
    for (let index = 0; index < rawUpdates.length; index++) {
      const entry = rawUpdates[index];
      const stepId = String(entry?.stepId || '').trim();
      const status = String(entry?.status || '').trim().toLowerCase();
      if (!stepId) {
        return {
          success: false,
          error: `updates[${index}].stepId is required.`
        };
      }
      if (!PlanningTools.STEP_STATUS_SET.has(status)) {
        return {
          success: false,
          error: `updates[${index}].status must be one of pending|in_progress|completed|failed|skipped (received: "${status}").`
        };
      }
      updates.push({
        stepId,
        status: status as any,
        reason: typeof entry?.reason === 'string' ? entry.reason : undefined,
        result: entry?.result
      });
    }

    const result = await this.planningManager.applyStepUpdates(planId, updates);
    return {
      ...result,
      source: params?.source || 'system',
      timestamp: typeof params?.timestamp === 'number' ? params.timestamp : Date.now()
    };
  }

  private validateCreatePlanInput(params: CreatePlanInput):
    | { valid: true; goal: string; steps: Array<CreatePlanInputStep & { id: string }> }
    | { valid: false; error: string } {
    const goal = (params?.goal || '').trim();
    if (!goal) {
      return { valid: false, error: 'create_plan requires a non-empty "goal".' };
    }
    if (goal.length > PlanningTools.MAX_GOAL_LENGTH) {
      return { valid: false, error: `Goal is too long (max ${PlanningTools.MAX_GOAL_LENGTH} characters).` };
    }

    const rawSteps = Array.isArray(params?.steps) ? params.steps : [];
    if (rawSteps.length === 0) {
      return { valid: false, error: 'create_plan requires at least one step in "steps".' };
    }
    if (rawSteps.length > PlanningTools.MAX_STEPS) {
      return { valid: false, error: `Too many plan steps (max ${PlanningTools.MAX_STEPS}).` };
    }

    const normalizedSteps: Array<CreatePlanInputStep & { id: string }> = [];
    const idSet = new Set<string>();

    for (let i = 0; i < rawSteps.length; i++) {
      const step = rawSteps[i];
      const description = String(step?.description || '').trim();
      const tool = this.normalizeStepToolName(String(step?.tool || '').trim());
      if (!description) {
        return { valid: false, error: `Step ${i + 1} has an empty description.` };
      }
      if (description.length > PlanningTools.MAX_DESCRIPTION_LENGTH) {
        return { valid: false, error: `Step ${i + 1} description is too long (max ${PlanningTools.MAX_DESCRIPTION_LENGTH} characters).` };
      }
      if (!tool) {
        return { valid: false, error: `Step ${i + 1} has no tool name.` };
      }
      if (this.toolRegistry?.has && !this.toolRegistry.has(tool)) {
        return {
          valid: false,
          error: `Step ${i + 1} uses unknown tool "${step?.tool}". Allowed tool example: "write_file".`
        };
      }

      const requestedId = String(step?.id || '').trim();
      const baseId = requestedId.length > 0 ? requestedId : `step-${i + 1}`;
      let stableId = baseId.replace(/\s+/g, '-').toLowerCase();
      if (!stableId) stableId = `step-${i + 1}`;
      if (idSet.has(stableId)) {
        stableId = `${stableId}-${i + 1}`;
      }
      idSet.add(stableId);

      const dependencies = Array.isArray(step?.dependencies)
        ? step.dependencies.map((dep) => String(dep).trim()).filter((dep) => dep.length > 0)
        : [];
      if (dependencies.length > PlanningTools.MAX_DEPENDENCIES_PER_STEP) {
        return {
          valid: false,
          error: `Step ${stableId} has too many dependencies (max ${PlanningTools.MAX_DEPENDENCIES_PER_STEP}).`
        };
      }

      normalizedSteps.push({
        id: stableId,
        description,
        tool,
        parameters: step?.parameters && typeof step.parameters === 'object' ? step.parameters : {},
        dependencies
      });
    }

    const knownIds = new Set(normalizedSteps.map((step) => step.id));
    for (const step of normalizedSteps) {
      for (const dep of step.dependencies || []) {
        if (!knownIds.has(dep)) {
          return { valid: false, error: `Step ${step.id} references unknown dependency "${dep}".` };
        }
        if (dep === step.id) {
          return { valid: false, error: `Step ${step.id} cannot depend on itself.` };
        }
      }
    }

    if (this.hasDependencyCycle(normalizedSteps)) {
      return { valid: false, error: 'Plan dependencies contain a cycle. Please provide an acyclic dependency graph.' };
    }

    return { valid: true, goal, steps: normalizedSteps };
  }

  private hasDependencyCycle(steps: Array<CreatePlanInputStep & { id: string }>): boolean {
    const graph = new Map<string, string[]>();
    for (const step of steps) {
      graph.set(step.id, [...(step.dependencies || [])]);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (node: string): boolean => {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      const deps = graph.get(node) || [];
      for (const dep of deps) {
        if (dfs(dep)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    };

    for (const node of graph.keys()) {
      if (dfs(node)) return true;
    }
    return false;
  }

  private normalizeStepToolName(rawToolName: string): string {
    const normalized = String(rawToolName || '').trim();
    if (!normalized) return normalized;
    const lower = normalized.toLowerCase();
    return PlanningTools.TOOL_ALIAS_MAP[lower] || lower;
  }
}
