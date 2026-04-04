// =====================================================
// ToolManager - Refactored Tool System Management
// =====================================================

import * as vscode from 'vscode';
import * as path from 'path';
import {
  ToolRegistry,
  FileTools,
  MemoryTools,
  ProjectTools,
  CheckpointTools,
  PlanningTools,
  MemoryBankTools,
  SafeEditTool,
  ApplyBlockEditTool,
  CommandTools,
  WebSearchTools,
  QuestionTools,
  ToolName
} from '../tools';
import { ToolParamValidator } from '../tools/ToolParamValidator';
import { IAgentService } from './index';
import { TerminalManager } from '../../terminal/TerminalManager';
import { PlanningManager } from './PlanningManager';
import { AutoApproveManager } from '../../approval/ApprovalManager';
import { HookManager } from '../../hooks/HookManager';
import { NotificationPayload } from '../../hooks/types';
import { telemetry } from '../../services/Telemetry';
import { LogService } from '../../services/LogService';
import { CircuitBreakerRegistry } from '../../core/resilience/CircuitBreakerRegistry';
import { ToolRunPhase, ToolRunStateMachine } from './runtime/ToolRunStateMachine';
import { ToolRetryPolicyEngine } from './runtime/ToolRetryPolicyEngine';
import { sleepWithAbort } from '../../core/resilience/RetryDelayUtils';

const log = new LogService('ToolManager');
const QUESTION_TIMEOUT_MS = 60_000;

type ToolResilienceCode =
  | 'TOOL_RETRY_SCHEDULED'
  | 'TOOL_RETRY_EXHAUSTED'
  | 'TOOL_STOPPED_BY_USER'
  | 'HOOK_PRE_BLOCKED'
  | 'HOOK_PRE_FAILED'
  | 'HOOK_POST_FAILED'
  | 'HOOK_NOTIFICATION_FAILED';

interface ToolResilienceSettings {
  toolOrchestratorV2: boolean;
  hookContractV2: boolean;
  toolTelemetryV2: boolean;
}

interface ToolRunContext {
  toolCallId?: string;
  flowId?: string | null;
  correlationId?: string;
  mode?: string;
  model?: string;
}

interface AskQuestionOption {
  label: string;
  description?: string;
  mode?: string;
}

interface AskQuestionParams {
  question: string;
  header?: string;
  options: AskQuestionOption[];
  multiple?: boolean;
}

type QuestionResolutionSource = 'user' | 'timeout_default' | 'stopped';

interface QuestionResolutionPayload {
  selectedOptionIndexes: number[];
  source: QuestionResolutionSource;
}

interface PendingQuestionEntry {
  resolve: (payload: QuestionResolutionPayload) => void;
  optionCount: number;
  multiple: boolean;
  timeoutHandle: NodeJS.Timeout;
  settled: boolean;
}

interface ExecuteToolCallInput {
  id: string;
  name: string;
  params: any;
  flowId?: string | null;
  correlationId?: string;
  mode?: string;
  model?: string;
}

interface ApprovalDecision {
  status: 'approved' | 'rejected';
  reason?: string;
  source: 'user' | 'system';
}

class ToolExecutionError extends Error {
  readonly code: ToolResilienceCode | 'TOOL_EXECUTION_FAILED' | 'TOOL_APPROVAL_REJECTED' | 'TOOL_VALIDATION_FAILED' | 'TOOL_CIRCUIT_BLOCKED' | 'TOOL_NOT_FOUND' | 'QUESTION_STOPPED';
  readonly retryable: boolean;
  readonly stoppedByUser: boolean;

  constructor(params: {
    code: ToolExecutionError['code'];
    message: string;
    retryable?: boolean;
    stoppedByUser?: boolean;
  }) {
    super(params.message);
    this.name = 'ToolExecutionError';
    this.code = params.code;
    this.retryable = params.retryable === true;
    this.stoppedByUser = params.stoppedByUser === true;
  }
}

export class ToolManager implements IAgentService {
  // Core tool components
  private toolRegistry: ToolRegistry;
  private fileTools: FileTools;
  private memoryTools: MemoryTools;
  private projectTools: ProjectTools;
  private checkpointTools: CheckpointTools;
  private planningTools: PlanningTools;
  private memoryBankTools: MemoryBankTools;
  private safeEditTool: SafeEditTool;
  private applyBlockEditTool: ApplyBlockEditTool;
  private commandTools: CommandTools;
  private webSearchTools: WebSearchTools;
  private questionTools: QuestionTools;

  // Dependencies
  private terminalManager: TerminalManager | null = null;
  private planningManager: PlanningManager;
  private autoApproveManager: AutoApproveManager;
  private hookManager: HookManager;
  private circuitBreakers: CircuitBreakerRegistry;

  // Configuration
  private debug: boolean = false;
  private eventCallback?: (event: any) => void;
  private modeProvider?: () => string | undefined;
  private lastToolName: string | null = null;
  private readonly toolParamValidator = new ToolParamValidator();
  private pendingQuestions: Map<string, PendingQuestionEntry> = new Map();

  constructor(
    toolRegistry: ToolRegistry,
    fileTools: FileTools,
    memoryTools: MemoryTools,
    projectTools: ProjectTools,
    checkpointTools: CheckpointTools,
    planningTools: PlanningTools,
    planningManager: PlanningManager,
    memoryBankTools: MemoryBankTools,
    safeEditTool: SafeEditTool,
    applyBlockEditTool: ApplyBlockEditTool,
    commandTools: CommandTools,
    webSearchTools: WebSearchTools,
    questionTools: QuestionTools,
    autoApproveManager: AutoApproveManager,
    hookManager: HookManager,
    circuitBreakers: CircuitBreakerRegistry
  ) {
    this.toolRegistry = toolRegistry;
    this.fileTools = fileTools;
    this.memoryTools = memoryTools;
    this.projectTools = projectTools;
    this.checkpointTools = checkpointTools;
    this.planningTools = planningTools;
    this.planningManager = planningManager;
    this.memoryBankTools = memoryBankTools;
    this.safeEditTool = safeEditTool;
    this.applyBlockEditTool = applyBlockEditTool;
    this.commandTools = commandTools;
    this.webSearchTools = webSearchTools;
    this.questionTools = questionTools;
    this.autoApproveManager = autoApproveManager;
    this.hookManager = hookManager;
    this.circuitBreakers = circuitBreakers;
  }

  async initialize(): Promise<void> {
    try {
      // Register all tools
      this.registerAllTools();

      if (this.debug) {
        console.log(`[ToolManager] Registered ${this.toolRegistry.getNames().length} tools`);
      }
    } catch (error) {
      console.error('[ToolManager] Initialization failed:', error);
      throw error;
    }
  }

  dispose(): void {
    // Clean up tool registry
    this.toolRegistry.clear();

    if (this.debug) {
      console.log('[ToolManager] Disposed successfully');
    }
  }

  // ==================== TOOL REGISTRY OPERATIONS ====================

  /**
   * Register all tools from all tool modules
   */
  private registerAllTools(): void {
    try {
      this.toolRegistry.clear();

      // Register tools from each module using the new pattern
      this.fileTools.registerTools(this.toolRegistry);
      this.memoryTools.registerTools(this.toolRegistry);
      this.projectTools.registerTools(this.toolRegistry);
      this.checkpointTools.registerTools(this.toolRegistry);
      this.planningTools.registerTools(this.toolRegistry);
      this.memoryBankTools.registerTools(this.toolRegistry);
      this.safeEditTool.registerTools(this.toolRegistry);
      this.applyBlockEditTool.registerTools(this.toolRegistry);
      this.commandTools.registerTools(this.toolRegistry);
      this.webSearchTools.registerTools(this.toolRegistry);
      this.questionTools.registerTools(this.toolRegistry);

      if (this.debug) {
        console.log(`[ToolManager] Registered ${this.toolRegistry.getNames().length} tools`);
      }
    } catch (error) {
      console.error('[ToolManager] Tool registration failed:', error);
      throw error;
    }
  }

  /**
   * Get all available tools
   */
  getAvailableTools(): any[] {
    return this.toolRegistry.getAll();
  }

  /**
   * Get tool by name
   */
  getTool(toolName: string): any {
    return this.toolRegistry.get(toolName);
  }

  /**
   * Check if tool exists
   */
  hasTool(toolName: string): boolean {
    return this.toolRegistry.has(toolName);
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return this.toolRegistry.getNames();
  }

  /**
   * Get auto approve manager
   */
  getAutoApproveManager(): AutoApproveManager {
    return this.autoApproveManager;
  }

  /**
   * Execute multiple tool calls, potentially in parallel.
   * Independent tools run simultaneously, while tools targeting the same files run sequentially.
   */
  async executeTools(toolCalls: ExecuteToolCallInput[]): Promise<{ id: string, result: any }[]> {
    if (this.debug) {
      console.log(`[ToolManager] Dispatching ${toolCalls.length} tool calls`);
    }

    const groups = this.groupToolCalls(toolCalls);
    const results: { id: string, result: any }[] = [];

    await Promise.allSettled(groups.map(async (group) => {
      for (const call of group) {
        const taskId = call.id;
        const toolName = call.name;
        const toolArgs = call.params;
        const runContext: ToolRunContext = {
          toolCallId: taskId,
          flowId: call.flowId ?? null,
          correlationId: call.correlationId,
          mode: call.mode,
          model: call.model
        };

        try {
          await this.ensurePlanExecutionStarted(toolName, toolArgs);
          // 1. Resolve planning context if applicable
          const planCtx = this.resolvePlanContext(toolName, toolArgs);
          
          // 2. Emit start events
          if (this.eventCallback) {
            import('../../views/chat/utils/ToolCallUtils').then(({ ToolCallUtils }) => {
              this.eventCallback!({
                type: 'taskStart',
                taskId,
                taskName: ToolCallUtils.getThinkingMessage(toolName, toolArgs)
              });
              this.eventCallback!({ type: 'taskUpdate', taskId, status: 'active' });
            });
          }

          // 3. Mark plan step as in-progress
          if (planCtx && this.planningManager) {
            await this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'in_progress');
            toolArgs.planId = planCtx.planId;
            toolArgs.stepId = planCtx.stepId;
          }

          // 4. Execution
          const result = await this.executeTool(toolName, toolArgs, runContext);
          results.push({ id: taskId, result });

          // 5. Handle success updates
          if (planCtx && this.planningManager) {
            await this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'completed', result);
            if (this.eventCallback) {
              this.eventCallback({ type: 'planStepCompleted', planId: planCtx.planId, stepId: planCtx.stepId, result });
            }
          }

          if (this.eventCallback) {
            import('../../views/chat/utils/ToolCallUtils').then(({ ToolCallUtils }) => {
              this.eventCallback!({ type: 'taskComplete', taskId });
              this.eventCallback!({
                type: 'toolComplete',
                tool: toolName,
                comment: ToolCallUtils.generateToolCompletionComment(toolName, toolArgs, result)
              });
            });
          }

        } catch (error) {
          results.push({ id: taskId, result: { error: String(error) } });
          
          if (this.eventCallback) {
            this.eventCallback({ type: 'taskComplete', taskId });
          }
          
          // Handle plan failure
          const planCtx = this.resolvePlanContext(toolName, toolArgs);
          if (planCtx && this.planningManager) {
             await this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'failed', undefined, String(error));
          }
        }
      }
    }));

    return results;
  }

  /**
   * Helper to resolve plan ID and step ID for a tool call if it's part of a plan.
   */
  private resolvePlanContext(toolName: string, params: any): { planId: string, stepId: string } | null {
    if (!this.planningManager) return null;
    
    const currentPlan = this.planningManager.getCurrentPlan();
    const targetPlanId = params.planId || currentPlan?.id;
    
    if (!targetPlanId) return null;
    
    const plan = this.planningManager.getPlan(targetPlanId);
    if (!plan || !['executing', 'pending', 'handed_over'].includes(String(plan.status))) return null;

    const requestedStepId = String(params?.stepId || '').trim();
    const normalizedToolName = this.normalizeToolAlias(toolName);
    const targetPath = this.extractTargetPath(params);

    const isOpenStep = (status: string): boolean => {
      const normalized = this.normalizeTaskStatus(status);
      return normalized === 'pending' || normalized === 'in_progress';
    };

    const step = requestedStepId
      ? plan.steps.find((s: any) => s.id === requestedStepId)
      : plan.steps.find((s: any) => {
          if (!isOpenStep(String(s.status || ''))) return false;
          const stepTool = this.normalizeToolAlias(String(s.tool || ''));
          if (stepTool !== normalizedToolName) return false;
          if (!targetPath) return true;
          const stepPath = this.extractTargetPath(s.parameters || {});
          if (!stepPath) return true;
          return this.isSamePath(stepPath, targetPath);
        });

    if (step) {
      return { planId: targetPlanId, stepId: step.id };
    }
    
    return null;
  }

  private normalizeToolAlias(toolName: string): string {
    const normalized = String(toolName || '').trim().toLowerCase();
    if (normalized === 'create_file') return 'write_file';
    if (normalized === 'write_file_chunk') return 'write_file';
    if (normalized === 'update_file' || normalized === 'modify_file') return 'safe_edit_file';
    return normalized;
  }

  private normalizeTaskStatus(status: string): 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped' {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'in_progress' || normalized === 'in-progress') return 'in_progress';
    if (normalized === 'completed') return 'completed';
    if (normalized === 'failed') return 'failed';
    if (normalized === 'skipped') return 'skipped';
    return 'pending';
  }

  private extractTargetPath(params: any): string | null {
    if (!params || typeof params !== 'object') return null;
    const raw = params.path || params.file_path;
    if (typeof raw !== 'string' || raw.trim().length === 0) return null;
    return path.normalize(raw.trim());
  }

  private isSamePath(left: string, right: string): boolean {
    return path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase();
  }

  private isPlanningControlTool(toolName: string): boolean {
    const normalized = this.normalizeToolAlias(toolName);
    return ['create_plan', 'update_plan_steps', 'handover_to_coder', 'ask_question'].includes(normalized);
  }

  private async ensurePlanExecutionStarted(toolName: string, params: any): Promise<void> {
    if (!this.planningManager) return;
    if (this.isPlanningControlTool(toolName)) return;
    const currentPlan = this.planningManager.getCurrentPlan();
    if (!currentPlan || !currentPlan.id) return;

    const targetPlanId = String(params?.planId || currentPlan.id).trim();
    if (!targetPlanId) return;
    const plan = this.planningManager.getPlan(targetPlanId);
    if (!plan) return;

    if (plan.status === 'handed_over' || plan.status === 'pending') {
      await this.planningManager.beginExecution(targetPlanId);
      params.planId = targetPlanId;
    }
  }

  /**
   * Groups tool calls that target the same file to ensure sequential execution for those files.
   * Independent tools each get their own group and run in parallel.
   */
  private groupToolCalls(toolCalls: ExecuteToolCallInput[]): ExecuteToolCallInput[][] {
    const fileToGroup = new Map<string, ExecuteToolCallInput[]>();
    const independentGroups: ExecuteToolCallInput[][] = [];
    const collectTargetPaths = (params: any): string[] => {
      const paths = new Set<string>();
      const directPath = params?.path || params?.file_path;
      if (typeof directPath === 'string' && directPath.trim().length > 0) {
        paths.add(path.normalize(directPath));
      }
      if (Array.isArray(params?.file_edits)) {
        for (const fileEdit of params.file_edits) {
          const nestedPath = fileEdit?.file_path || fileEdit?.path;
          if (typeof nestedPath === 'string' && nestedPath.trim().length > 0) {
            paths.add(path.normalize(nestedPath));
          }
        }
      }
      return Array.from(paths);
    };

    for (const call of toolCalls) {
      const targetPaths = collectTargetPaths(call.params);
      
      // Only group if it's a file-modifying tool and has at least one target path
      const isFileModifying = ['write_file', 'edit_file', 'safe_edit_file', 'apply_block_edit', 'delete_file'].includes(call.name);
      
      if (isFileModifying && targetPaths.length > 0) {
        let group = targetPaths
          .map((p) => fileToGroup.get(p))
          .find((candidate): candidate is ExecuteToolCallInput[] => Array.isArray(candidate));

        if (!group) {
          group = [];
          independentGroups.push(group);
        }

        group.push(call);
        for (const targetPath of targetPaths) {
          fileToGroup.set(targetPath, group);
        }
      } else {
        // Independent tool (read, system, etc.)
        independentGroups.push([call]);
      }
    }

    return independentGroups;
  }

  // ==================== TOOL EXECUTION ====================

  /**
   * Execute a tool with hooks and auto-approval check
   */
  async executeTool(toolName: string, params: any, runContext: ToolRunContext = {}): Promise<any> {
    const settings = this.getResilienceSettings();
    const v2Enabled = settings.toolOrchestratorV2;
    if (!v2Enabled) {
      return this.executeToolLegacy(toolName, params);
    }
    return this.executeToolV2(toolName, params, runContext, settings);
  }

  private async executeToolLegacy(toolName: string, params: any): Promise<any> {
    const currentMode = this.modeProvider?.();
    
    // Anti-Loop Check for handover_to_coder
    if (toolName === 'handover_to_coder' && this.lastToolName === 'handover_to_coder') {
      throw new Error(`Cannot call handover_to_coder consecutively - already in handover state`);
    }

    try {
      return await telemetry.withSpan(
        'tool.execute',
        { 'tool.name': toolName, mode: currentMode || 'unknown' },
        async (toolSpan) => {
          const tool = this.toolRegistry.get(toolName);
          if (!tool) {
            throw new Error(`Tool not found: ${toolName}`);
          }

          // Handle task_progress if present
          if (params && params.task_progress && this.eventCallback) {
            this.eventCallback({
              type: 'taskProgress',
              label: params.task_progress
            });
          }
          params = this.toolParamValidator.sanitizeInternalFields(params);

          // 1. PRE-HOOKS
          const preHookResult = await this.hookManager.executePreHooks(toolName, params);
          if (preHookResult.blocked) {
            throw new Error(`Tool execution blocked by hook: ${preHookResult.reason || 'Unknown reason'}`);
          }
          params = this.toolParamValidator.sanitizeInternalFields(preHookResult.modifiedParams);

          // 2. VALIDATION CHECK
          const validationResult = await telemetry.withSpan(
            'tool.validation',
            { 'tool.name': toolName },
            async (validationSpan) => {
              const result = this.toolParamValidator.validate(toolName, params);
              validationSpan.setAttributes({
                'validation.outcome': result.valid ? 'ok' : 'failed',
                'validation.error_count': result.errors.length
              });
              if (!result.valid) {
                validationSpan.setStatusError('tool_validation_failed');
              }
              return result;
            }
          );

          if (!validationResult.valid) {
            const first = validationResult.errors[0];
            log.event(
              'WARN',
              'tool.validation.failed',
              `Tool validation failed for ${toolName}`,
              { tool: toolName, errors: validationResult.errors }
            );
            toolSpan.setStatusError('tool_validation_failed');
            throw new Error(JSON.stringify(first));
          }

          // 2.5 CIRCUIT BREAKER CHECK
          const gate = this.circuitBreakers.canExecute('tool.execute', toolName);
          if (!gate.decision.allowed) {
            const payload: NotificationPayload = {
              channel: 'circuit_breaker',
              severity: 'warning',
              action: 'wait',
              retryAfter: gate.decision.retryAfterMs,
              message: `Circuit breaker open for ${gate.key}`,
              metadata: { toolName, circuitKey: gate.key, state: gate.decision.state }
            };
            await this.hookManager.executeNotification(payload);
            log.event('WARN', 'circuit.reject', `Circuit breaker rejected ${toolName}`, payload.metadata);
            throw new Error(`CIRCUIT_OPEN_REJECT: Tool "${toolName}" temporarily blocked. Retry after ${gate.decision.retryAfterMs || 0}ms.`);
          }
          if (gate.transition === 'half_open') {
            const payload: NotificationPayload = {
              channel: 'circuit_breaker',
              severity: 'warning',
              action: 'retry',
              message: `Circuit breaker half-open for ${gate.key}`,
              metadata: { toolName, circuitKey: gate.key, state: gate.decision.state }
            };
            await this.hookManager.executeNotification(payload);
            log.event('WARN', 'circuit.half_open', `Circuit breaker half-open for ${toolName}`, payload.metadata);
          }

          // 3. APPROVAL CHECK
          const autoApproved = await this.autoApproveManager.shouldAutoApprove(toolName, params);
          if (!autoApproved) {
            const approved = await this.requestApproval(toolName, params);
            if (!approved) {
              throw new Error('Tool execution rejected by user');
            }
          }

          if (this.debug) {
            console.log(`[ToolManager] Executing ${toolName}`, params);
          }

          // 4. EXECUTION
          const executionStart = Date.now();
          const isWriteTool = toolName === 'write_file';
          const writePath = params?.path || params?.file_path;
          const contentLength = typeof params?.content === 'string' ? params.content.length : 0;
          const result = await tool.execute(params);
          const successUpdate = this.circuitBreakers.recordSuccess('tool.execute', toolName);
          if (successUpdate.transition === 'closed') {
            const payload: NotificationPayload = {
              channel: 'circuit_breaker',
              severity: 'info',
              message: `Circuit breaker closed for ${successUpdate.key}`,
              metadata: { toolName, circuitKey: successUpdate.key }
            };
            await this.hookManager.executeNotification(payload);
            log.event('INFO', 'circuit.closed', `Circuit breaker closed for ${toolName}`, payload.metadata);
          }
          if (isWriteTool) {
            log.event('INFO', 'tool.write_file.completed', 'write_file completed', {
              duration_ms: Date.now() - executionStart,
              tool: toolName,
              file_path: writePath,
              bytes: contentLength
            });
          }

          // 5. POST-HOOKS
          await this.hookManager.executePostHooks(toolName, params, result);

          // Reset or update lastToolName
          if (toolName !== 'handover_to_coder') {
            this.lastToolName = toolName;
          }

          return result;
        }
      );
    } catch (error) {
      const recoverable = this.isRecoverableToolError(error);
      const breaker = this.circuitBreakers.recordFailure('tool.execute', recoverable, toolName);
      if (breaker.transition === 'opened') {
        await this.hookManager.executeNotification({
          channel: 'circuit_breaker',
          severity: 'error',
          action: 'wait',
          message: `Circuit breaker opened for ${breaker.key}`,
          metadata: { toolName, circuitKey: breaker.key }
        });
        log.event('ERROR', 'circuit.opened', `Circuit breaker opened for ${toolName}`, {
          toolName,
          circuitKey: breaker.key
        });
      }
      log.error(`Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  private async executeToolV2(
    toolName: string,
    rawParams: any,
    runContext: ToolRunContext,
    settings: ToolResilienceSettings
  ): Promise<any> {
    const currentMode = runContext.mode || this.modeProvider?.() || 'unknown';
    const retryPolicy = new ToolRetryPolicyEngine();
    const retryConfig = retryPolicy.getPolicy();
    let attemptsUsed = 0;
    let params = this.toolParamValidator.sanitizeInternalFields(rawParams);
    let terminalized = false;

    // Anti-loop check remains strict and non-retryable
    if (toolName === 'handover_to_coder' && this.lastToolName === 'handover_to_coder') {
      throw new ToolExecutionError({
        code: 'TOOL_EXECUTION_FAILED',
        message: 'Cannot call handover_to_coder consecutively - already in handover state',
        retryable: false
      });
    }

    while (attemptsUsed < retryConfig.recoverableRetries + 1) {
      const stateMachine = new ToolRunStateMachine();
      attemptsUsed += 1;
      const attempt = attemptsUsed;
      const correlationId = this.createToolCorrelationId(runContext, toolName, attempt);

      this.emitToolTelemetryEvent(
        settings,
        'TOOL_ATTEMPT_START',
        {
          code: 'TOOL_RETRY_SCHEDULED',
          toolName,
          attempt,
          maxAttempts: retryConfig.recoverableRetries + 1,
          flowId: runContext.flowId || null,
          correlationId,
          mode: currentMode,
          model: runContext.model || 'unknown'
        }
      );

      try {
        const tool = this.toolRegistry.get(toolName);
        if (!tool) {
          throw new ToolExecutionError({
            code: 'TOOL_NOT_FOUND',
            message: `Tool not found: ${toolName}`,
            retryable: false
          });
        }

        if (params && params.task_progress && this.eventCallback) {
          this.eventCallback({
            type: 'taskProgress',
            label: params.task_progress
          });
        }
        params = this.toolParamValidator.sanitizeInternalFields(params);

        stateMachine.transition('PRE_HOOK', 'pre_hook_start');
        const preHookResult = await this.hookManager.executePreHooks(toolName, params, {
          flowId: runContext.flowId || undefined,
          correlationId,
          toolCallId: runContext.toolCallId,
          attempt,
          phase: 'PRE_HOOK',
          mode: currentMode
        });
        if (preHookResult.blocked) {
          const code = preHookResult.code || 'HOOK_PRE_BLOCKED';
          throw new ToolExecutionError({
            code,
            message: preHookResult.reason || `Tool execution blocked by pre-hook (${preHookResult.hookName || 'unknown'})`,
            retryable: false
          });
        }
        params = this.toolParamValidator.sanitizeInternalFields(preHookResult.modifiedParams);

        stateMachine.transition('VALIDATE', 'validation_start');
        const validationResult = await telemetry.withSpan(
          'tool.validation',
          { 'tool.name': toolName },
          async (validationSpan) => {
            const result = this.toolParamValidator.validate(toolName, params);
            validationSpan.setAttributes({
              'validation.outcome': result.valid ? 'ok' : 'failed',
              'validation.error_count': result.errors.length
            });
            if (!result.valid) {
              validationSpan.setStatusError('tool_validation_failed');
            }
            return result;
          }
        );
        if (!validationResult.valid) {
          const first = validationResult.errors[0];
          throw new ToolExecutionError({
            code: 'TOOL_VALIDATION_FAILED',
            message: JSON.stringify(first),
            retryable: false
          });
        }

        stateMachine.transition('CIRCUIT', 'circuit_check');
        const gate = this.circuitBreakers.canExecute('tool.execute', toolName);
        if (!gate.decision.allowed) {
          const notificationResult = await this.hookManager.executeNotification({
            channel: 'circuit_breaker',
            severity: 'warning',
            action: 'wait',
            retryAfter: gate.decision.retryAfterMs,
            message: `Circuit breaker open for ${gate.key}`,
            metadata: { toolName, circuitKey: gate.key, state: gate.decision.state }
          }, {
            flowId: runContext.flowId || undefined,
            correlationId,
            toolCallId: runContext.toolCallId,
            attempt,
            phase: 'CIRCUIT',
            mode: currentMode
          });
          this.emitHookFailures(settings, notificationResult.failures, runContext, attempt, correlationId);
          throw new ToolExecutionError({
            code: 'TOOL_CIRCUIT_BLOCKED',
            message: `CIRCUIT_OPEN_REJECT: Tool "${toolName}" temporarily blocked. Retry after ${gate.decision.retryAfterMs || 0}ms.`,
            retryable: false
          });
        }
        if (gate.transition === 'half_open') {
          const notificationResult = await this.hookManager.executeNotification({
            channel: 'circuit_breaker',
            severity: 'warning',
            action: 'retry',
            message: `Circuit breaker half-open for ${gate.key}`,
            metadata: { toolName, circuitKey: gate.key, state: gate.decision.state }
          }, {
            flowId: runContext.flowId || undefined,
            correlationId,
            toolCallId: runContext.toolCallId,
            attempt,
            phase: 'CIRCUIT',
            mode: currentMode
          });
          this.emitHookFailures(settings, notificationResult.failures, runContext, attempt, correlationId);
        }

        stateMachine.transition('APPROVAL', 'approval_check');
        const autoApproved = await this.autoApproveManager.shouldAutoApprove(toolName, params);
        if (!autoApproved) {
          const decision = await this.requestApprovalDecision(toolName, params);
          if (decision.status === 'rejected') {
            const stoppedByUser =
              decision.source === 'user' ||
              String(decision.reason || '').trim().toLowerCase() === 'aborted_by_user_stop';
            throw new ToolExecutionError({
              code: 'TOOL_APPROVAL_REJECTED',
              message: stoppedByUser ? 'Tool execution aborted by user stop' : 'Tool execution rejected by user',
              retryable: false,
              stoppedByUser
            });
          }
        }

        stateMachine.transition('EXECUTE', 'tool_execute');
        let result: any;
        try {
          if (toolName === 'ask_question') {
            result = await this.executeAskQuestionViaWebview(params, runContext);
          } else {
            result = await tool.execute(params);
          }
        } catch (error) {
          if (error instanceof ToolExecutionError) {
            throw error;
          }
          throw new ToolExecutionError({
            code: 'TOOL_EXECUTION_FAILED',
            message: error instanceof Error ? error.message : String(error),
            retryable: this.isRecoverableToolError(error)
          });
        }

        const successUpdate = this.circuitBreakers.recordSuccess('tool.execute', toolName);
        if (successUpdate.transition === 'closed') {
          const notificationResult = await this.hookManager.executeNotification({
            channel: 'circuit_breaker',
            severity: 'info',
            message: `Circuit breaker closed for ${successUpdate.key}`,
            metadata: { toolName, circuitKey: successUpdate.key }
          }, {
            flowId: runContext.flowId || undefined,
            correlationId,
            toolCallId: runContext.toolCallId,
            attempt,
            phase: 'EXECUTE',
            mode: currentMode
          });
          this.emitHookFailures(settings, notificationResult.failures, runContext, attempt, correlationId);
        }
        stateMachine.transition('POST_HOOK', 'post_hook');
        const postHookResult = await this.hookManager.executePostHooks(toolName, params, result, {
          flowId: runContext.flowId || undefined,
          correlationId,
          toolCallId: runContext.toolCallId,
          attempt,
          phase: 'POST_HOOK',
          mode: currentMode
        });
        this.emitHookFailures(settings, postHookResult.failures, runContext, attempt, correlationId);

        if (attempt > 1) {
          this.emitToolTelemetryEvent(settings, 'TOOL_RECOVERY_APPLIED', {
            code: 'TOOL_RETRY_SCHEDULED',
            toolName,
            flowId: runContext.flowId || null,
            correlationId,
            attempt,
            mode: currentMode,
            model: runContext.model || 'unknown'
          });
        }

        if (toolName !== 'handover_to_coder') {
          this.lastToolName = toolName;
        }

        stateMachine.terminalize('completed', 'tool_completed');
        stateMachine.ensureTerminalized();
        terminalized = true;
        return result;
      } catch (error) {
        const normalized = this.normalizeToolExecutionError(error);
        const recoverableDecision = retryPolicy.decideRecoverableRetry({
          attemptsUsed: attempt,
          recoverable: normalized.retryable,
          stateChanged: true
        });

        if (
          (normalized.code === 'TOOL_APPROVAL_REJECTED' && normalized.stoppedByUser)
          || normalized.code === 'QUESTION_STOPPED'
        ) {
          this.emitToolResilienceStatus(settings, {
            code: 'TOOL_STOPPED_BY_USER',
            category: 'tool',
            severity: 'info',
            retryable: false,
            attempt,
            maxAttempts: retryConfig.recoverableRetries + 1,
            model: runContext.model || 'unknown',
            flowId: runContext.flowId || null,
            userMessage: normalized.message,
            action: 'none',
            phase: 'stopped',
            decision: 'abort',
            reason: normalized.code,
            correlationId
          });
          this.emitToolTelemetryEvent(settings, 'TOOL_STOPPED_BY_USER', {
            code: 'TOOL_STOPPED_BY_USER',
            toolName,
            flowId: runContext.flowId || null,
            correlationId,
            attempt,
            mode: currentMode,
            model: runContext.model || 'unknown'
          });
          stateMachine.terminalize('stopped', 'approval_rejected');
          terminalized = true;
          throw new Error(normalized.message);
        }

        if (recoverableDecision.shouldRetry) {
          stateMachine.beginRetry();
          this.emitToolResilienceStatus(settings, {
            code: 'TOOL_RETRY_SCHEDULED',
            category: 'tool',
            severity: 'warning',
            retryable: true,
            attempt: recoverableDecision.nextAttempt,
            maxAttempts: recoverableDecision.maxAttempts,
            nextDelayMs: recoverableDecision.delayMs,
            model: runContext.model || 'unknown',
            flowId: runContext.flowId || null,
            userMessage: `Tool failed temporarily. Retrying... (${recoverableDecision.nextAttempt}/${recoverableDecision.maxAttempts})`,
            action: 'retry',
            phase: 'retry',
            decision: 'retry',
            reason: normalized.code,
            correlationId
          });
          this.emitToolTelemetryEvent(settings, 'TOOL_RETRY_SCHEDULED', {
            code: 'TOOL_RETRY_SCHEDULED',
            toolName,
            flowId: runContext.flowId || null,
            correlationId,
            attempt: recoverableDecision.nextAttempt,
            maxAttempts: recoverableDecision.maxAttempts,
            nextDelayMs: recoverableDecision.delayMs,
            mode: currentMode,
            model: runContext.model || 'unknown'
          });
          if (recoverableDecision.delayMs > 0) {
            await this.sleep(recoverableDecision.delayMs);
          }
          stateMachine.endRetry();
          continue;
        }

        const terminalCode: ToolResilienceCode =
          normalized.code === 'HOOK_PRE_BLOCKED'
            ? 'HOOK_PRE_BLOCKED'
            : normalized.code === 'HOOK_PRE_FAILED'
              ? 'HOOK_PRE_FAILED'
              : 'TOOL_RETRY_EXHAUSTED';

        this.emitToolResilienceStatus(settings, {
          code: terminalCode,
          category: terminalCode.startsWith('HOOK_') ? 'hook' : 'tool',
          severity: 'error',
          retryable: false,
          attempt,
          maxAttempts: retryConfig.recoverableRetries + 1,
          model: runContext.model || 'unknown',
          flowId: runContext.flowId || null,
          userMessage: normalized.message,
          action: terminalCode.startsWith('HOOK_') ? 'retry' : 'retry',
          phase: 'terminal',
          decision: 'abort',
          reason: normalized.code,
          correlationId
        });
        this.emitToolTelemetryEvent(settings, 'TOOL_TERMINAL_FAILURE', {
          code: terminalCode,
          toolName,
          flowId: runContext.flowId || null,
          correlationId,
          attempt,
          mode: currentMode,
          model: runContext.model || 'unknown'
        });

        stateMachine.terminalize('failed', 'terminal_failure');
        terminalized = true;
        throw new Error(normalized.message);
      } finally {
        if (terminalized) {
          try {
            stateMachine.ensureTerminalized();
          } catch (error) {
            log.error('Tool run terminal invariant violation', error);
          }
        }
      }
    }

    throw new Error(`Tool retry budget exhausted for ${toolName}`);
  }

  private normalizeToolExecutionError(error: unknown): ToolExecutionError {
    if (error instanceof ToolExecutionError) return error;
    return new ToolExecutionError({
      code: 'TOOL_EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      retryable: this.isRecoverableToolError(error)
    });
  }

  private emitHookFailures(
    settings: ToolResilienceSettings,
    failures: Array<{ code: 'HOOK_PRE_FAILED' | 'HOOK_POST_FAILED' | 'HOOK_NOTIFICATION_FAILED'; hookName: string; message: string }>,
    runContext: ToolRunContext,
    attempt: number,
    correlationId: string
  ): void {
    if (!failures || failures.length === 0) return;
    for (const failure of failures) {
      const statusCode = failure.code;
      const resilienceCode: ToolResilienceCode =
        statusCode === 'HOOK_POST_FAILED'
          ? 'HOOK_POST_FAILED'
          : statusCode === 'HOOK_NOTIFICATION_FAILED'
            ? 'HOOK_NOTIFICATION_FAILED'
            : 'HOOK_PRE_FAILED';
      this.emitToolResilienceStatus(settings, {
        code: resilienceCode,
        category: 'hook',
        severity: statusCode === 'HOOK_PRE_FAILED' ? 'error' : 'warning',
        retryable: false,
        attempt,
        maxAttempts: attempt,
        model: runContext.model || 'unknown',
        flowId: runContext.flowId || null,
        userMessage: `Hook ${failure.hookName} failed: ${failure.message}`,
        action: 'none',
        phase: 'runtime',
        decision: 'report',
        reason: failure.code,
        correlationId
      });
      this.emitToolTelemetryEvent(settings, 'HOOK_EXECUTION_FAILED', {
        code: resilienceCode,
        hookName: failure.hookName,
        flowId: runContext.flowId || null,
        correlationId,
        attempt,
        mode: runContext.mode || this.modeProvider?.() || 'unknown',
        model: runContext.model || 'unknown'
      });
    }
  }

  private async executeAskQuestionViaWebview(
    params: Record<string, unknown> | undefined,
    runContext: ToolRunContext
  ): Promise<{
    success: boolean;
    answer: string[];
    message: string;
    requestedMode: string | null;
    continuationPrompt: string;
  }> {
    const question = typeof params?.question === 'string' ? params.question.trim() : '';
    const header = typeof params?.header === 'string' ? params.header.trim() : '';
    const multiple = params?.multiple === true;
    const rawOptions = Array.isArray(params?.options) ? params.options : [];
    const options: AskQuestionOption[] = [];
    for (const rawOpt of rawOptions) {
      if (!rawOpt || typeof rawOpt !== 'object') {
        continue;
      }

      const option = rawOpt as Record<string, unknown>;
      const label = typeof option.label === 'string' ? option.label.trim() : '';
      if (!label) {
        continue;
      }

      options.push({
        label,
        description: typeof option.description === 'string' ? option.description.trim() : undefined,
        mode: typeof option.mode === 'string' ? option.mode.trim() : undefined
      });
    }

    if (!question || options.length === 0) {
      return {
        success: false,
        answer: [],
        message: 'Invalid ask_question input. Expected non-empty question and at least one option.',
        requestedMode: null,
        continuationPrompt: 'ask_question input was invalid. Continue without mode switch.'
      };
    }

    const defaultOptionIndex = 0;
    const questionId = this.createQuestionId(runContext);
    const resolution = await this.awaitQuestionResolution({
      questionId,
      header: header.length > 0 ? header : undefined,
      question,
      options,
      multiple,
      timeoutMs: QUESTION_TIMEOUT_MS,
      defaultOptionIndex
    });

    if (resolution.source === 'stopped') {
      throw new ToolExecutionError({
        code: 'QUESTION_STOPPED',
        message: 'Question stopped by user.',
        retryable: false,
        stoppedByUser: true
      });
    }

    let selectedOptionIndexes = this.sanitizeQuestionSelection(
      resolution.selectedOptionIndexes,
      options.length,
      multiple
    );
    if (selectedOptionIndexes.length === 0) {
      selectedOptionIndexes = [defaultOptionIndex];
    }

    const selectedOptions = selectedOptionIndexes.map((index) => options[index]).filter(Boolean);
    const answer = selectedOptions.map((opt) => opt.label);
    const requestedMode = (selectedOptions.find((opt) => typeof opt.mode === 'string' && opt.mode.trim().length > 0)?.mode || null) as string | null;
    const answerText = answer.join(', ');

    const message = resolution.source === 'timeout_default'
      ? `Auto-selected default option: ${answerText}`
      : `User selected: ${answerText}`;
    const continuationPrompt = requestedMode
      ? `User selected "${answer[0] || 'option'}". Continue in ${requestedMode} mode.`
      : `User selected: ${answerText}. Continue accordingly.`;

    return {
      success: true,
      answer,
      message,
      requestedMode,
      continuationPrompt
    };
  }

  private async awaitQuestionResolution(args: {
    questionId: string;
    header?: string;
    question: string;
    options: AskQuestionOption[];
    multiple: boolean;
    timeoutMs: number;
    defaultOptionIndex: number;
  }): Promise<QuestionResolutionPayload> {
    if (!this.eventCallback) {
      return {
        selectedOptionIndexes: [args.defaultOptionIndex],
        source: 'timeout_default'
      };
    }

    return new Promise((resolve) => {
      const resolveOnce = (payload: QuestionResolutionPayload) => {
        const entry = this.pendingQuestions.get(args.questionId);
        if (!entry || entry.settled) return;
        entry.settled = true;
        clearTimeout(entry.timeoutHandle);
        this.pendingQuestions.delete(args.questionId);
        this.emitQuestionResolved(args.questionId, payload.selectedOptionIndexes, payload.source);
        resolve(payload);
      };

      const timeoutHandle = setTimeout(() => {
        resolveOnce({
          selectedOptionIndexes: [args.defaultOptionIndex],
          source: 'timeout_default'
        });
      }, args.timeoutMs);

      this.pendingQuestions.set(args.questionId, {
        resolve: resolveOnce,
        optionCount: args.options.length,
        multiple: args.multiple,
        timeoutHandle,
        settled: false
      });

      this.emitQuestionRequest({
        questionId: args.questionId,
        header: args.header,
        question: args.question,
        options: args.options,
        multiple: args.multiple,
        timeoutMs: args.timeoutMs,
        defaultOptionIndex: args.defaultOptionIndex
      });
    });
  }

  private emitQuestionRequest(payload: {
    questionId: string;
    header?: string;
    question: string;
    options: AskQuestionOption[];
    multiple: boolean;
    timeoutMs: number;
    defaultOptionIndex: number;
  }): void {
    if (!this.eventCallback) return;
    this.eventCallback({
      type: 'questionRequest',
      questionId: payload.questionId,
      header: payload.header,
      question: payload.question,
      options: payload.options,
      multiple: payload.multiple,
      timeoutMs: payload.timeoutMs,
      defaultOptionIndex: payload.defaultOptionIndex,
      timestamp: Date.now()
    });
  }

  private emitQuestionResolved(
    questionId: string,
    selectedOptionIndexes: number[],
    source: QuestionResolutionSource
  ): void {
    if (!this.eventCallback) return;
    this.eventCallback({
      type: 'questionResolved',
      questionId,
      selectedOptionIndexes,
      source,
      timestamp: Date.now()
    });
  }

  private sanitizeQuestionSelection(indices: number[], optionCount: number, multiple: boolean): number[] {
    const uniqueOrdered = Array.from(
      new Set(
        (Array.isArray(indices) ? indices : [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value))
          .filter((value) => value >= 0 && value < optionCount)
      )
    ).sort((a, b) => a - b);

    if (!multiple && uniqueOrdered.length > 1) {
      return [uniqueOrdered[0]];
    }
    return uniqueOrdered;
  }

  private createQuestionId(runContext: ToolRunContext): string {
    const flowId = runContext.flowId || 'flow-unknown';
    const toolCallId = runContext.toolCallId || 'toolcall-unknown';
    const nonce = Math.random().toString(36).slice(2, 9);
    return `question_${flowId}_${toolCallId}_${nonce}`;
  }

  private getResilienceSettings(): ToolResilienceSettings {
    const config = vscode.workspace.getConfiguration('gently');
    return {
      toolOrchestratorV2: config.get<boolean>('resilience.toolOrchestratorV2', true),
      hookContractV2: config.get<boolean>('resilience.hookContractV2', true),
      toolTelemetryV2: config.get<boolean>('resilience.toolTelemetryV2', true)
    };
  }

  private createToolCorrelationId(runContext: ToolRunContext, toolName: string, attempt: number): string {
    if (runContext.correlationId && runContext.correlationId.trim() !== '') {
      return runContext.correlationId;
    }
    const flowId = runContext.flowId || 'flow-unknown';
    const toolCallId = runContext.toolCallId || 'toolcall-unknown';
    return `${flowId}:${toolName}:${toolCallId}:${Math.max(1, Math.floor(attempt))}`;
  }

  private emitToolResilienceStatus(
    settings: ToolResilienceSettings,
    payload: {
      code: ToolResilienceCode;
      category: 'tool' | 'hook';
      severity: 'info' | 'warning' | 'error';
      retryable: boolean;
      attempt: number;
      maxAttempts: number;
      nextDelayMs?: number;
      model: string;
      flowId: string | null;
      userMessage: string;
      action: 'retry' | 'none';
      phase: 'runtime' | 'retry' | 'terminal' | 'stopped';
      decision: 'retry' | 'abort' | 'report';
      reason: string;
      correlationId: string;
    }
  ): void {
    if (!this.eventCallback) return;
    this.eventCallback({
      type: 'resilienceStatus',
      code: payload.code,
      category: payload.category,
      severity: payload.severity,
      retryable: payload.retryable,
      attempt: payload.attempt,
      maxAttempts: payload.maxAttempts,
      nextDelayMs: payload.nextDelayMs,
      model: payload.model,
      flowId: payload.flowId,
      userMessage: payload.userMessage,
      action: payload.action,
      phase: payload.phase,
      decision: payload.decision,
      reason: payload.reason,
      correlationId: payload.correlationId
    });
  }

  private emitToolTelemetryEvent(
    settings: ToolResilienceSettings,
    eventName:
      | 'TOOL_ATTEMPT_START'
      | 'TOOL_RETRY_SCHEDULED'
      | 'TOOL_RECOVERY_APPLIED'
      | 'TOOL_TERMINAL_FAILURE'
      | 'TOOL_STOPPED_BY_USER'
      | 'HOOK_EXECUTION_FAILED',
    metadata: Record<string, unknown>
  ): void {
    if (!settings.toolTelemetryV2) return;
    const level =
      eventName === 'TOOL_TERMINAL_FAILURE'
        ? 'ERROR'
        : eventName === 'TOOL_RETRY_SCHEDULED' || eventName === 'HOOK_EXECUTION_FAILED'
          ? 'WARN'
          : 'INFO';
    log.event(level, eventName, eventName, metadata);
  }

  private async sleep(ms: number): Promise<void> {
    await sleepWithAbort(ms);
  }

  private isRecoverableToolError(error: unknown): boolean {
    const message = String((error as any)?.message || error || '').toLowerCase();
    if (!message) return true;
    return (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('temporarily') ||
      message.includes('rate') ||
      message.includes('busy') ||
      message.includes('econnreset')
    );
  }

  /**
   * Request approval for a tool execution
   * Returns a promise that resolves when the user approves or rejects
   */
  private async requestApprovalDecision(toolName: string, params: any): Promise<ApprovalDecision> {
    return new Promise((resolve) => {
      const approvalId = `tool_approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();

      if (!this.eventCallback) {
        resolve({
          status: 'rejected',
          reason: 'approval_callback_unavailable',
          source: 'system'
        });
        return;
      }

      this.eventCallback({
        type: 'toolApprovalRequest',
        approvalId,
        toolName,
        params,
        timestamp
      });

      this.pendingApprovals.set(approvalId, {
        resolve: (decision: ApprovalDecision) => {
          this.emitToolApprovalResolved(approvalId, toolName, decision);
          resolve(decision);
        },
        toolName
      });
    });
  }

  /**
   * Request approval for a tool execution
   * Returns a promise that resolves when the user approves or rejects
   */
  private async requestApproval(toolName: string, params: any): Promise<boolean> {
    return new Promise((resolve) => {
      const approvalId = `tool_approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();
      
      console.log(`[ToolManager] ═════════════════════════════════════`);
      console.log(`[ToolManager] APPROVAL REQUEST START`);
      console.log(`[ToolManager] Tool: ${toolName}`);
      console.log(`[ToolManager] ID: ${approvalId}`);
      console.log(`[ToolManager] eventCallback: ${this.eventCallback ? '✅ SET' : '❌ NOT SET'}`);
      console.log(`[ToolManager] Pending queue size: ${this.pendingApprovals.size}`);
      console.log(`[ToolManager] ═════════════════════════════════════`);

      if (!this.eventCallback) {
        console.error(`[ToolManager] ❌ CRITICAL: eventCallback is not set!`);
        console.error(`[ToolManager] This means the UI will never receive the approval request!`);
        throw new Error('Tool approval system not initialized. Please restart the extension.');
      }

      this.eventCallback({
          type: 'toolApprovalRequest',
          approvalId,
          toolName,
          params,
          timestamp
      });
      
      console.log(`[ToolManager] ✅ Approval request sent to webview (ID: ${approvalId})`);

      this.pendingApprovals.set(approvalId, {
        resolve: (decision: ApprovalDecision) => {
          console.log(`[ToolManager] 📩 Response received for ${approvalId}: ${decision.status === 'approved' ? '✅ APPROVED' : '❌ REJECTED'}`);
          this.emitToolApprovalResolved(approvalId, toolName, decision);
          resolve(decision.status === 'approved');
        },
        toolName
      });
    });
  }

  private pendingApprovals: Map<string, { resolve: (decision: ApprovalDecision) => void, toolName: string }> = new Map();

  public handleApprovalResponse(approvalId: string, approved: boolean, alwaysApprove: boolean = false): void {
    const entry = this.pendingApprovals.get(approvalId);
    if (entry) {
      if (alwaysApprove && approved) {
        this.autoApproveManager.addAutoApproval(entry.toolName);
      }
      entry.resolve({
        status: approved ? 'approved' : 'rejected',
        reason: alwaysApprove && approved ? 'approved_and_remembered' : approved ? 'approved' : 'rejected_by_user',
        source: 'user'
      });
      this.pendingApprovals.delete(approvalId);
    }
  }

  public handleQuestionResponse(
    questionId: string,
    selectedOptionIndexes: number[],
    source: 'user' | 'stopped' = 'user'
  ): void {
    const entry = this.pendingQuestions.get(questionId);
    if (!entry || entry.settled) return;

    const sanitizedSelection = this.sanitizeQuestionSelection(
      selectedOptionIndexes,
      entry.optionCount,
      entry.multiple
    );

    if (source === 'stopped') {
      entry.resolve({
        selectedOptionIndexes: [],
        source: 'stopped'
      });
      return;
    }

    entry.resolve({
      selectedOptionIndexes: sanitizedSelection,
      source: 'user'
    });
  }

  /**
   * Abort all pending tool executions and approvals
   */
  public abortAllExecutions(): void {
    console.log(`[ToolManager] 🛑 Aborting pending interactions (approvals=${this.pendingApprovals.size}, questions=${this.pendingQuestions.size})`);
    
    // 1. Resolve all pending approvals with 'false'
    for (const [approvalId, entry] of this.pendingApprovals.entries()) {
      entry.resolve({
        status: 'rejected',
        reason: 'aborted_by_user_stop',
        source: 'system'
      });
      this.pendingApprovals.delete(approvalId);
    }

    // 2. Resolve all pending questions as stopped
    for (const [questionId, entry] of this.pendingQuestions.entries()) {
      entry.resolve({
        selectedOptionIndexes: [],
        source: 'stopped'
      });
      this.pendingQuestions.delete(questionId);
    }
    
    // 3. Clear lastToolName to prevent loop detection issues after abort
    this.lastToolName = null;
    
    if (this.debug) {
      console.log('[ToolManager] All tool executions aborted');
    }
  }


  /**
   * Execute tool safely with error handling
   */
  async executeToolSafely(toolName: string, params: any): Promise<{ success: boolean; result?: any; error?: string }> {
    try {
      const result = await this.executeTool(toolName, params);
      return { success: true, result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  // ==================== TOOL FORMATS ====================

  /**
   * Get tools in generic API format
   */
  getFormattedTools(): any[] {
    return this.toolRegistry.getFormattedTools();
  }

  /**
   * Get planning-only tools for ArchitectMode
   */
  getPlanningOnlyTools(): any[] {
    const allTools = this.toolRegistry.getAll();

    // Whitelist: Only these tools are allowed in Architect mode
    const allowedToolNames = [
      'create_plan',
      'update_plan_steps',
      'handover_to_coder',
      'ask_question',
      'read_file',
      'list_files',
      'find_files',
      'regex_search',
      'recall_memories',
      'analyze_project_structure',
      'update_memory_bank',
      'query_long_term_memory'
    ];

    // Filter tools to only allowed ones
    const architectTools = allTools.filter(tool =>
      allowedToolNames.includes(tool.name)
    );

    return architectTools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * Get tools for prompt (legacy format)
   */
  getToolsForPrompt(): string {
    return this.toolRegistry.getToolsForPrompt();
  }

  private emitToolApprovalResolved(approvalId: string, toolName: string, decision: ApprovalDecision): void {
    if (!this.eventCallback) return;
    this.eventCallback({
      type: 'toolApprovalResolved',
      approvalId,
      toolName,
      status: decision.status,
      reason: decision.reason || null,
      source: decision.source,
      timestamp: Date.now()
    });
  }

  /**
   * Get structured tool specs for PromptBuilder.
   */
  getPromptToolSpecs(toolNames?: string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.toolRegistry.getPromptToolSpecs(toolNames);
  }

  // ==================== TOOL MODULE MANAGEMENT ====================

  /**
   * Update terminal manager reference
   */
  setTerminalManager(terminalManager: TerminalManager): void {
    this.terminalManager = terminalManager;

    // Update planning tools with terminal manager
    this.planningTools = new PlanningTools(
      this.planningManager,
      this.terminalManager,
      this.toolRegistry,
      this.modeProvider
    );

    // Update command tools with terminal manager
    this.commandTools = new CommandTools(
      () => this.terminalManager,
      this.eventCallback || (() => { })
    );

    // Re-register all tools to ensure planning and command tools have the updated reference
    this.registerAllTools();

    if (this.debug) {
      console.log('[ToolManager] Terminal manager updated');
    }
  }

  /**
   * Set event callback for UI updates
   */
  setEventCallback(callback: (event: any) => void): void {
    this.eventCallback = callback;

    // Propagate to CommandTools
    if (this.commandTools && (this.commandTools as any).setEventCallback) {
      (this.commandTools as any).setEventCallback(callback);
    }
  }

  /**
   * Set the current mode provider
   */
  setCurrentModeProvider(provider: () => string | undefined): void {
    this.modeProvider = provider;
  }

  // ==================== TOOL CATEGORIES ====================

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): any[] {
    return this.toolRegistry.getAll().filter(tool =>
      tool.category?.toLowerCase() === category.toLowerCase()
    );
  }

  /**
   * Get file-related tools
   */
  getFileTools(): any[] {
    return this.getToolsByCategory('file');
  }

  /**
   * Get memory-related tools
   */
  getMemoryTools(): any[] {
    return this.getToolsByCategory('memory');
  }

  /**
   * Get planning-related tools
   */
  getPlanningTools(): any[] {
    return this.getToolsByCategory('planning');
  }

  /**
   * Get project-related tools
   */
  getProjectTools(): any[] {
    return this.getToolsByCategory('project');
  }

  /**
   * Get checkpoint-related tools
   */
  getCheckpointTools(): any[] {
    return this.getToolsByCategory('checkpoint');
  }

  // ==================== TOOL STATISTICS ====================

  /**
   * Get tool statistics
   */
  getToolStats(): { total: number; categories: Record<string, number> } {
    const allTools = this.toolRegistry.getAll();
    const categories: Record<string, number> = {};

    allTools.forEach(tool => {
      const category = tool.category || 'unknown';
      categories[category] = (categories[category] || 0) + 1;
    });

    return {
      total: allTools.length,
      categories
    };
  }

  /**
   * Get detailed tool info
   */
  getToolInfo(): any[] {
    return this.toolRegistry.getAll().map(tool => ({
      name: tool.name,
      description: tool.description,
      category: tool.category || 'unknown',
      parameters: tool.parameters
    }));
  }

  // ==================== DEBUG AND UTILITY ====================

  /**
   * Enable/disable debug logging
   */
  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  /**
   * Get tool registry instance
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Clear all tools (for testing)
   */
  clearTools(): void {
    this.toolRegistry.clear();
  }

  /**
   * Validate tool parameters
   */
  validateToolParams(toolName: string, params: any): { valid: boolean; errors: string[] } {
    const result = this.toolParamValidator.validate(toolName, params);
    return {
      valid: result.valid,
      errors: result.errors.map((error) => `${error.field}: ${error.message}`)
    };
  }
}
