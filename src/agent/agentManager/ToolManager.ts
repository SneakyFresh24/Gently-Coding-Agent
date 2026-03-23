// =====================================================
// ToolManager - Refactored Tool System Management
// =====================================================

import * as path from 'path';
import {
  ToolRegistry,
  FileTools,
  MemoryTools,
  ProjectTools,
  CheckpointTools,
  PlanningTools,
  VerificationTools,
  MemoryBankTools,
  SafeEditTool,
  ApplyBlockEditTool,
  CommandTools,
  WebSearchTools,
  QuestionTools,
  ToolName
} from '../tools';
import { IAgentService } from './index';
import { TerminalManager } from '../../terminal/TerminalManager';
import { PlanningManager } from './PlanningManager';
import { AutoApproveManager } from '../../approval/ApprovalManager';
import { HookManager } from '../../hooks/HookManager';

export class ToolManager implements IAgentService {
  // Core tool components
  private toolRegistry: ToolRegistry;
  private fileTools: FileTools;
  private memoryTools: MemoryTools;
  private projectTools: ProjectTools;
  private checkpointTools: CheckpointTools;
  private planningTools: PlanningTools;
  private verificationTools: VerificationTools;
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

  // Configuration
  private debug: boolean = false;
  private eventCallback?: (event: any) => void;
  private modeProvider?: () => string | undefined;
  private lastToolName: string | null = null;

  constructor(
    toolRegistry: ToolRegistry,
    fileTools: FileTools,
    memoryTools: MemoryTools,
    projectTools: ProjectTools,
    checkpointTools: CheckpointTools,
    planningTools: PlanningTools,
    planningManager: PlanningManager,
    verificationTools: VerificationTools,
    memoryBankTools: MemoryBankTools,
    safeEditTool: SafeEditTool,
    applyBlockEditTool: ApplyBlockEditTool,
    commandTools: CommandTools,
    webSearchTools: WebSearchTools,
    questionTools: QuestionTools,
    autoApproveManager: AutoApproveManager,
    hookManager: HookManager
  ) {
    this.toolRegistry = toolRegistry;
    this.fileTools = fileTools;
    this.memoryTools = memoryTools;
    this.projectTools = projectTools;
    this.checkpointTools = checkpointTools;
    this.planningTools = planningTools;
    this.planningManager = planningManager;
    this.verificationTools = verificationTools;
    this.memoryBankTools = memoryBankTools;
    this.safeEditTool = safeEditTool;
    this.applyBlockEditTool = applyBlockEditTool;
    this.commandTools = commandTools;
    this.webSearchTools = webSearchTools;
    this.questionTools = questionTools;
    this.autoApproveManager = autoApproveManager;
    this.hookManager = hookManager;
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
      this.verificationTools.registerTools(this.toolRegistry);
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
  async executeTools(toolCalls: { id: string, name: string, params: any }[]): Promise<{ id: string, result: any }[]> {
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

        try {
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
            this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'in-progress');
            toolArgs.planId = planCtx.planId;
            toolArgs.stepId = planCtx.stepId;
          }

          // 4. Execution
          const result = await this.executeTool(toolName, toolArgs);
          results.push({ id: taskId, result });

          // 5. Handle success updates
          if (planCtx && this.planningManager) {
            this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'completed', result);
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
             this.planningManager.updateStepStatus(planCtx.planId, planCtx.stepId, 'failed', undefined, String(error));
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
    if (!plan || (plan.status !== 'executing' && plan.status !== 'pending')) return null;

    const step = params.stepId 
      ? plan.steps.find((s: any) => s.id === params.stepId) 
      : plan.steps.find((s: any) => s.tool === toolName && (s.status === 'in-progress' || s.status === 'pending'));

    if (step) {
      return { planId: targetPlanId, stepId: step.id };
    }
    
    return null;
  }

  /**
   * Groups tool calls that target the same file to ensure sequential execution for those files.
   * Independent tools each get their own group and run in parallel.
   */
  private groupToolCalls(toolCalls: { id: string, name: string, params: any }[]): { id: string, name: string, params: any }[][] {
    const fileToGroup = new Map<string, { id: string, name: string, params: any }[]>();
    const independentGroups: { id: string, name: string, params: any }[][] = [];

    for (const call of toolCalls) {
      const filePath = call.params?.path || call.params?.file_path;
      
      // Only group if it's a file-modifying tool and has a path
      const isFileModifying = ['write_file', 'edit_file', 'safe_edit_file', 'apply_block_edit', 'delete_file'].includes(call.name);
      
      if (isFileModifying && filePath) {
        const normalizedPath = path.normalize(filePath);
        if (!fileToGroup.has(normalizedPath)) {
          const group: { id: string, name: string, params: any }[] = [];
          fileToGroup.set(normalizedPath, group);
          independentGroups.push(group);
        }
        fileToGroup.get(normalizedPath)!.push(call);
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
  async executeTool(toolName: string, params: any): Promise<any> {
    const currentMode = this.modeProvider?.();
    
    // Anti-Loop Check for handover_to_coder
    if (toolName === 'handover_to_coder' && this.lastToolName === 'handover_to_coder') {
      throw new Error(`Cannot call handover_to_coder consecutively - already in handover state`);
    }

    try {
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
        const { task_progress, ...rest } = params;
        params = rest;
      }

      // 1. PRE-HOOKS
      const preHookResult = await this.hookManager.executePreHooks(toolName, params);
      if (preHookResult.blocked) {
        throw new Error(`Tool execution blocked by hook: ${preHookResult.reason || 'Unknown reason'}`);
      }
      params = preHookResult.modifiedParams;

      // 2. APPROVAL CHECK
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

      // 3. EXECUTION
      const result = await tool.execute(params);

      // 4. POST-HOOKS
      await this.hookManager.executePostHooks(toolName, params, result);

      // Reset or update lastToolName
      if (toolName !== 'handover_to_coder') {
          this.lastToolName = toolName;
      }

      return result;
    } catch (error) {
      console.error(`[ToolManager] Error executing tool ${toolName}:`, error);
      throw error;
    }
  }

  /**
   * Request approval for a tool execution
   * Returns a promise that resolves when the user approves or rejects
   */
  private async requestApproval(toolName: string, params: any): Promise<boolean> {
    return new Promise((resolve) => {
      const approvalId = `tool_approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
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

      const timeout = setTimeout(() => {
        console.warn(`[ToolManager] ⏱️ Approval TIMEOUT for ${toolName} (ID: ${approvalId}) after 5 minutes`);
        this.pendingApprovals.delete(approvalId);
        resolve(false);
      }, 5 * 60 * 1000);

      this.eventCallback({
          type: 'toolApprovalRequest',
          approvalId,
          toolName,
          params,
          timestamp: Date.now()
      });
      
      console.log(`[ToolManager] ✅ Approval request sent to webview (ID: ${approvalId})`);

      this.pendingApprovals.set(approvalId, {
        resolve: (approved: boolean) => {
          clearTimeout(timeout);
          console.log(`[ToolManager] 📩 Response received for ${approvalId}: ${approved ? '✅ APPROVED' : '❌ REJECTED'}`);
          resolve(approved);
        },
        toolName
      });
    });
  }

  private pendingApprovals: Map<string, { resolve: (approved: boolean) => void, toolName: string }> = new Map();

  public handleApprovalResponse(approvalId: string, approved: boolean, alwaysApprove: boolean = false): void {
    const entry = this.pendingApprovals.get(approvalId);
    if (entry) {
      if (alwaysApprove && approved) {
        this.autoApproveManager.addAutoApproval(entry.toolName);
      }
      entry.resolve(approved);
      this.pendingApprovals.delete(approvalId);
    }
  }

  /**
   * Abort all pending tool executions and approvals
   */
  public abortAllExecutions(): void {
    console.log(`[ToolManager] 🛑 Aborting all ${this.pendingApprovals.size} pending approvals`);
    
    // 1. Resolve all pending approvals with 'false'
    for (const [approvalId, entry] of this.pendingApprovals.entries()) {
      entry.resolve(false);
      this.pendingApprovals.delete(approvalId);
    }
    
    // 2. Clear lastToolName to prevent loop detection issues after abort
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
    const tool = this.toolRegistry.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool not found: ${toolName}`] };
    }

    const errors: string[] = [];

    // Basic parameter validation
    if (!tool.parameters || !tool.parameters.properties) {
      return { valid: true, errors: [] };
    }

    const required = tool.parameters.required || [];
    const properties = tool.parameters.properties;

    // Check required parameters
    for (const param of required) {
      if (!(param in params)) {
        errors.push(`Missing required parameter: ${param}`);
      }
    }

    // Check parameter types
    for (const [param, value] of Object.entries(params)) {
      if (properties[param] && properties[param].type) {
        const expectedType = properties[param].type;
        const actualType = Array.isArray(value) ? 'array' : typeof value;

        if (expectedType !== actualType) {
          errors.push(`Parameter ${param} should be ${expectedType}, got ${actualType}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
