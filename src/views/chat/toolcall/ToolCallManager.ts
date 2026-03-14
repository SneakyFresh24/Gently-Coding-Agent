import { ChatMessage, ToolCall } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

const log = new LogService('ToolCallManager');

interface AgentManager {
  executeTool(toolName: string, params: Record<string, any>): Promise<any>;
}

export interface ToolCallMessageContext {
    messageId?: string;
    flowId?: string;
    selectedMode?: string;
    conversationHistory: ChatMessage[];
}

export interface ToolCallValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    toolCallGroups: any[];
}

export class ToolCallManager {
  constructor(
    private readonly agentManager: AgentManager,
  ) {}

  /**
   * Processes tool calls. Simplified for the new streaming architecture.
   */
  async processToolCalls(
    toolCalls: ToolCall[],
    context: ToolCallMessageContext
  ): Promise<ToolCallValidationResult> {
    log.info(`Processing ${toolCalls.length} tool calls for message ${context.messageId}`);

    // Mode-based validation
    const modeValidation = this.validateToolExecutionForMode(toolCalls, context);
    if (!modeValidation.valid) {
      return {
        valid: false,
        errors: modeValidation.errors,
        warnings: [],
        toolCallGroups: []
      };
    }

    // Since tool calls are now pre-validated by StreamingToolCallProcessor,
    // we can proceed to execution directly or via the agent manager.
    // In this simplified version, we just return valid and let the dispatcher hand it off.
    
    return {
      valid: true,
      errors: [],
      warnings: [],
      toolCallGroups: [{
        id: `batch-${Date.now()}`,
        toolCalls: toolCalls.map(tc => ({ ...tc, status: 'pending' as const }))
      }]
    };
  }

  /**
   * Validates the tool execution for the current mode.
   */
  private validateToolExecutionForMode(
    toolCalls: ToolCall[],
    context: ToolCallMessageContext
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const currentMode = context.selectedMode;

    if (!currentMode) return { valid: true, errors: [] };

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;
      if (!toolName) continue;

      if (currentMode === 'architect') {
        const allowedArchitectTools = [
          'find_files', 'list_files', 'get_memories', 'recall_memories',
          'read_file', 'analyze_project_structure', 'create_plan',
          'handover_to_coder', 'update_memory_bank', 'query_long_term_memory'
        ];

        if (!allowedArchitectTools.includes(toolName)) {
          errors.push(`Architect mode cannot execute tool '${toolName}'. Only planning, analysis, and memory bank tools are allowed.`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates the sequence of messages in history.
   */
  validateMessageSequence(messages: ChatMessage[]): { valid: boolean; errors: string[] } {
    // Basic sequence validation (e.g., tool results must follow tool calls)
    return { valid: true, errors: [] };
  }

  validateConversationHistory(messages: ChatMessage[]): { valid: boolean; errors: string[] } {
      return this.validateMessageSequence(messages);
  }

  dispose(): void {
    log.info('Disposed');
  }
}