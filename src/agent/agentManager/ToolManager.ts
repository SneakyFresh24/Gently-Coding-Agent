// =====================================================
// ToolManager - Refactored Tool System Management
// =====================================================

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
  ToolName
} from '../tools';
import { IAgentService } from './index';
import { TerminalManager } from '../../terminal/TerminalManager';
import { PlanningManager } from './PlanningManager';
import { AutoApproveManager } from '../../approval/AutoApproveManager';
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

  // Dependencies
  private terminalManager: TerminalManager | null = null;
  private planningManager: PlanningManager;
  private autoApproveManager: AutoApproveManager;
  private hookManager: HookManager;

  // Configuration
  private debug: boolean = false;
  private eventCallback?: (event: any) => void;
  private modeProvider?: () => string | undefined;

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

  // ==================== TOOL EXECUTION ====================

  /**
   * Execute a tool with hooks and auto-approval check
   */
  async executeTool(toolName: string, params: any): Promise<any> {
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
        console.log(`[ToolManager] Executing tool: ${toolName}`, params);
      }

      // 3. EXECUTION
      const result = await tool.execute(params);

      // 4. POST-HOOKS
      await this.hookManager.executePostHooks(toolName, params, result);

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
    if (!this.eventCallback) return false;

    return new Promise((resolve) => {
      const approvalId = `tool_approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Map to the existing commandApprovalRequest pattern for now, 
      // or we might need a dedicated toolApprovalRequest message
      const callback = this.eventCallback;
      if (callback) {
        callback({
          type: 'toolApprovalRequest',
          approvalId,
          toolName,
          params,
          timestamp: Date.now()
        });
      }

      // Simple one-time listener pattern (needs to be handled in ChatViewProvider)
      // For now we'll assume the response comes back via a handler we'll add
      const listener = (event: any) => {
        if (event.type === 'toolApprovalResponse' && event.approvalId === approvalId) {
          resolve(event.approved);
          // In a real system we'd need to remove this listener
        }
      };

      // We'll actually handle this via ToolManager.handleApprovalResponse called from ChatViewProvider
      this.pendingApprovals.set(approvalId, resolve);
    });
  }

  private pendingApprovals: Map<string, (approved: boolean) => void> = new Map();

  public handleApprovalResponse(approvalId: string, approved: boolean): void {
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      resolve(approved);
      this.pendingApprovals.delete(approvalId);
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
      'read_file',
      'list_files',
      'find_files',
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

    // Update planning tools with new callback
    this.planningTools = new PlanningTools(
      this.planningManager as any,
      this.terminalManager,
      this.toolRegistry,
      this.modeProvider
    );
  }

  /**
   * Set the current mode provider
   */
  setCurrentModeProvider(provider: () => string | undefined): void {
    this.modeProvider = provider;

    // Update planning tools with the new mode provider
    this.planningTools = new PlanningTools(
      this.planningManager,
      this.terminalManager,
      this.toolRegistry,
      this.modeProvider
    );

    // Re-register to apply changes
    this.registerAllTools();
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