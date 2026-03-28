import { ChatMessage, ToolCall } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';
import { createHash } from 'crypto';

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

export interface ConversationRepairResult {
    repaired: boolean;
    fixes: string[];
    issuesBefore: string[];
    issuesAfter: string[];
    repairHash?: string;
    messages: ChatMessage[];
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
          'find_files', 'regex_search', 'list_files', 'recall_memories',
          'read_file', 'analyze_project_structure', 'create_plan',
          'handover_to_coder', 'ask_question', 'update_memory_bank', 'query_long_term_memory'
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
    const issues: string[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCalls = msg.tool_calls.filter((tc: any) => tc && typeof tc.id === 'string' && tc.id.trim() !== '');
        let cursor = i + 1;

        for (const toolCall of toolCalls) {
          const toolCallId = String(toolCall.id);
          let firstRelevant: ChatMessage | undefined;
          while (cursor < messages.length) {
            const candidate = messages[cursor];
            if (candidate.role === 'tool' || candidate.role === 'user' || candidate.role === 'assistant') {
              firstRelevant = candidate;
              break;
            }
            cursor += 1;
          }

          if (!firstRelevant) {
            issues.push(`missing_result:${toolCallId}`);
            continue;
          }

          if (firstRelevant.role !== 'tool') {
            issues.push(`out_of_order_result:${toolCallId}`);
            continue;
          }

          if (firstRelevant.tool_call_id !== toolCallId) {
            issues.push(`mismatched_result:${toolCallId}->${firstRelevant.tool_call_id || 'none'}`);
            cursor += 1;
            continue;
          }
          cursor += 1;
        }
      }

      if (msg.role === 'tool' && msg.tool_call_id) {
        const toolCallId = String(msg.tool_call_id);
        const previous = messages.slice(0, i);
        const hasAssistantCall = previous.some((prev) =>
          prev.role === 'assistant' &&
          Array.isArray(prev.tool_calls) &&
          prev.tool_calls.some((tc: any) => tc && tc.id === toolCallId)
        );
        if (!hasAssistantCall) {
          issues.push(`orphan_result:${toolCallId}`);
        }
      }
    }

    return { valid: issues.length === 0, errors: issues };
  }

  repairConversationHistory(messages: ChatMessage[]): ConversationRepairResult {
    const issuesBefore = this.validateMessageSequence(messages).errors;
    const fixes: string[] = [];
    if (issuesBefore.length === 0) {
      return {
        repaired: false,
        fixes,
        issuesBefore,
        issuesAfter: [],
        repairHash: undefined,
        messages
      };
    }

    const assistantToolCallMap = new Map<string, { index: number; call: any }>();
    messages.forEach((msg, index) => {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        msg.tool_calls.forEach((call: any) => {
          if (call && typeof call.id === 'string' && call.id.trim() !== '') {
            assistantToolCallMap.set(call.id, { index, call });
          }
        });
      }
    });

    const cleanedMessages: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id && !assistantToolCallMap.has(msg.tool_call_id)) {
        fixes.push(`Removed orphan tool_call_id=${msg.tool_call_id}`);
        continue;
      }
      cleanedMessages.push(msg);
    }

    const toolMessageByCallId = new Map<string, ChatMessage>();
    for (const msg of cleanedMessages) {
      if (msg.role === 'tool' && msg.tool_call_id && !toolMessageByCallId.has(msg.tool_call_id)) {
        toolMessageByCallId.set(msg.tool_call_id, msg);
      }
    }

    const consumedToolCallIds = new Set<string>();
    const repairedMessages: ChatMessage[] = [];
    for (const msg of cleanedMessages) {
      if (msg.role === 'tool' && msg.tool_call_id && consumedToolCallIds.has(msg.tool_call_id)) {
        continue;
      }

      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        repairedMessages.push(msg);
        for (const toolCall of msg.tool_calls) {
          const toolCallId = toolCall?.id;
          if (!toolCallId || typeof toolCallId !== 'string') continue;
          const existing = toolMessageByCallId.get(toolCallId);
          if (existing) {
            repairedMessages.push(existing);
            consumedToolCallIds.add(toolCallId);
          } else {
            repairedMessages.push({
              role: 'tool',
              content: JSON.stringify({ error: 'Missing tool result in history' }),
              tool_call_id: toolCallId
            });
            fixes.push(`Added placeholder for ${toolCallId}`);
            consumedToolCallIds.add(toolCallId);
          }
        }
        continue;
      }

      repairedMessages.push(msg);
    }

    const issuesAfter = this.validateMessageSequence(repairedMessages).errors;
    return {
      repaired: fixes.length > 0,
      fixes,
      issuesBefore,
      issuesAfter,
      repairHash: this.computeRepairHash(issuesBefore),
      messages: repairedMessages
    };
  }

  private computeRepairHash(issues: string[]): string | undefined {
    if (!issues || issues.length === 0) return undefined;
    const normalized = [...issues].sort().join('|');
    return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
  }

  validateConversationHistory(messages: ChatMessage[]): { valid: boolean; errors: string[] } {
      return this.validateMessageSequence(messages);
  }

  dispose(): void {
    log.info('Disposed');
  }
}
