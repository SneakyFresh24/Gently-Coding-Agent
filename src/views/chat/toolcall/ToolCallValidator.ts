import { ChatMessage } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

const log = new LogService('ToolCallValidator');

import {
  ToolCall,
  ToolCallGroup,
  ToolCallValidationResult,
  ToolCallMessageContext,
  ToolCallValidator as IToolCallValidator
} from './types/ToolCallTypes';

export class ToolCallValidator implements IToolCallValidator {

  /**
   * Validiert eingehende Tool-Call-Nachrichten
   */
  validateToolCalls(toolCalls: ToolCall[], context: ToolCallMessageContext): ToolCallValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const toolCallGroups: ToolCallGroup[] = [];

    try {
      // 1. Grundlegende Validierung der Tool-Call-Struktur
      const structureValidation = this.validateToolCallStructure(toolCalls);
      errors.push(...structureValidation.errors);
      warnings.push(...structureValidation.warnings);

      if (errors.length > 0) {
        return { valid: false, errors, warnings, toolCallGroups: [] };
      }

      // 2. Erstelle Tool-Call-Gruppen
      const groupId = this.generateGroupId(context.messageId);
      const toolCallGroup: ToolCallGroup = {
        id: groupId,
        messageId: context.messageId || 'unknown',
        toolCalls: this.convertToToolCalls(toolCalls),
        status: 'pending',
        createdAt: Date.now()
      };
      toolCallGroups.push(toolCallGroup);

      // 3. Validate the message sequence in context
      // IMPORTANT: Skip checking for missing tool messages as they are still being created
      const sequenceValidation = this.validateMessageSequence(context.conversationHistory, {
        skipMissingToolMessagesCheck: true
      });
      errors.push(...sequenceValidation.errors);

      // 4. Prüfe auf potenzielle Konflikte mit existierenden Tool-Calls
      const conflictValidation = this.validateToolCallConflicts(toolCallGroup, context);
      errors.push(...conflictValidation.errors);
      warnings.push(...conflictValidation.warnings);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        toolCallGroups
      };

    } catch (error) {
      errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { valid: false, errors, warnings, toolCallGroups: [] };
    }
  }


  /**
   * Validiert die korrekte Reihenfolge von Nachrichten in der Konversation
   */
  validateMessageSequence(messages: ChatMessage[], options: { skipMissingToolMessagesCheck?: boolean } = {}): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const toolCallIds = new Set<string>();
    let lastAssistantIndex = -1;

    // Durchlaufe alle Nachrichten und überprüfe die Reihenfolge
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // Finde Assistant-Nachrichten mit Tool-Calls
      if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
        lastAssistantIndex = i;

        // Sammle alle Tool-Call-IDs
        message.tool_calls.forEach((tc: any) => {
          toolCallIds.add(tc.id);
        });

        // Überprüfe, ob nachfolgende Tool-Nachrichten existieren (nur wenn nicht übersprungen)
        if (!options.skipMissingToolMessagesCheck) {
          const missingToolMessages = this.findMissingToolMessages(messages, i, message.tool_calls);
          if (missingToolMessages.length > 0) {
            errors.push(`Assistant message at index ${i} has tool_calls without corresponding tool messages: ${missingToolMessages.join(', ')}`);
          }
        }
      }

      // Überprüfe Tool-Nachrichten auf gültige tool_call_id
      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          errors.push(`Tool message at index ${i} missing tool_call_id`);
        } else if (!toolCallIds.has(message.tool_call_id)) {
          errors.push(`Tool message at index ${i} has invalid tool_call_id: ${message.tool_call_id}`);
        }
      }
    }

    // Überprüfe auf verwaiste Tool-Nachrichten (nur wenn nicht übersprungen)
    if (!options.skipMissingToolMessagesCheck) {
      const orphanedToolMessages = this.findOrphanedToolMessages(messages, toolCallIds);
      if (orphanedToolMessages.length > 0) {
        errors.push(`Orphaned tool messages found without preceding tool_calls: ${orphanedToolMessages.join(', ')}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validiert die grundlegende Struktur der Tool-Calls
   */
  private validateToolCallStructure(toolCalls: ToolCall[]): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(toolCalls)) {
      errors.push('tool_calls must be an array');
      return { errors, warnings };
    }

    if (toolCalls.length === 0) {
      warnings.push('Empty tool_calls array received');
      return { errors, warnings };
    }

    toolCalls.forEach((toolCall, index) => {
      if (!toolCall.id) {
        errors.push(`Tool call ${index} missing id`);
      }

      if (!toolCall.type || toolCall.type !== 'function') {
        errors.push(`Tool call ${index} has invalid type: ${toolCall.type}`);
      }

      if (!toolCall.function) {
        errors.push(`Tool call ${index} missing function object`);
      } else {
        if (!toolCall.function.name) {
          errors.push(`Tool call ${index} missing function name`);
        }

        if (!toolCall.function.arguments) {
          errors.push(`Tool call ${index} missing function arguments`);
        } else {
          // Versuche, die Argumente zu parsen
          try {
            JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            errors.push(`Tool call ${index} has invalid JSON arguments: ${parseError}`);
          }
        }
      }
    });

    return { errors, warnings };
  }

  /**
   * Konvertiert Tool-Calls zum internen Format
   */
  private convertToToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.map(tc => ({
      id: tc.id,
      type: tc.type,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments
      },
      status: 'pending' as const
    }));
  }


  /**
   * Findet fehlende Tool-Nachrichten für gegebene Tool-Calls
   */
  private findMissingToolMessages(messages: ChatMessage[], assistantIndex: number, toolCalls: any[]): string[] {
    const missingIds: string[] = [];

    toolCalls.forEach(tc => {
      let found = false;

      // Suche in den nächsten Nachrichten nach der entsprechenden Tool-Nachricht
      for (let i = assistantIndex + 1; i < Math.min(assistantIndex + 1 + toolCalls.length * 2, messages.length); i++) {
        const message = messages[i];
        if (message.role === 'tool' && message.tool_call_id === tc.id) {
          found = true;
          break;
        }
      }

      if (!found) {
        missingIds.push(tc.id);
      }
    });

    return missingIds;
  }

  /**
   * Findet verwaiste Tool-Nachrichten
   */
  private findOrphanedToolMessages(messages: ChatMessage[], validToolCallIds: Set<string>): string[] {
    const orphanedIds: string[] = [];

    messages.forEach(message => {
      if (message.role === 'tool' && message.tool_call_id && !validToolCallIds.has(message.tool_call_id)) {
        orphanedIds.push(message.tool_call_id);
      }
    });

    return orphanedIds;
  }

  /**
   * Validiert Konflikte mit existierenden Tool-Calls
   */
  private validateToolCallConflicts(toolGroup: ToolCallGroup, context: ToolCallMessageContext): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Überprüfe auf doppelte Tool-Call-IDs im aktuellen Flow
    if (context.flowId) {
      // Hier könnten wir eine zentrale Registry prüfen
      // Für jetzt nur eine grundlegende Warnung
      if (toolGroup.toolCalls.length > 5) {
        warnings.push(`Large number of tool calls (${toolGroup.toolCalls.length}) in single message`);
      }
    }

    return { errors, warnings };
  }

  /**
   * Generiert eine eindeutige Gruppen-ID
   */
  private generateGroupId(messageId?: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    const base = messageId || 'unknown';
    return `group-${base}-${timestamp}-${random}`;
  }
}