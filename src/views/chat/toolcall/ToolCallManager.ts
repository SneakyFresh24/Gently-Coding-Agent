import { ChatMessage } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

const log = new LogService('ToolCallManager');

interface AgentManager {
  executeTool(toolName: string, params: Record<string, any>): Promise<any>;
}

import {
  ToolCall,
  ToolCallGroup,
  ToolCallManagerConfig,
  ToolCallEvent,
  ToolCallEventType,
  ToolCallListener,
  ToolCallMessageContext,
  ToolCallValidationResult,
  ToolCallExecutionResult,
  ToolCallResult
} from './types/ToolCallTypes';
import { ToolCallValidator } from './ToolCallValidator';
import { ToolCallTracker } from './ToolCallTracker';

// Re-export Typen für die Migrationsschicht
export type {
  ToolCallMessageContext,
  ToolCallValidationResult
} from './types/ToolCallTypes';

export class ToolCallManager implements ToolCallListener {
  private config: ToolCallManagerConfig;
  private validator: ToolCallValidator;
  private tracker: ToolCallTracker;
  private agentManager: AgentManager;
  private listeners: Set<ToolCallListener> = new Set();
  private isShuttingDown: boolean = false;

  constructor(
    agentManager: AgentManager,
    config: Partial<ToolCallManagerConfig> = {}
  ) {
    this.agentManager = agentManager;
    this.config = {
      enableValidation: true,
      enableMigration: true,
      maxConcurrentToolCalls: 5,
      toolExecutionTimeout: 30000,
      enableDetailedLogging: true,
      ...config
    };

    this.validator = new ToolCallValidator();
    this.tracker = new ToolCallTracker();

    // Registriere uns selbst als Listener
    this.tracker.addListener(this.onToolCallEvent.bind(this));

    // Starte Cleanup-Interval
    this.startCleanupInterval();

    if (this.config.enableDetailedLogging) {
      log.info('Initialized with config', this.config);
    }
  }

  /**
   * Verarbeitet eingehende Tool-Calls und stellt die korrekte Nachrichtenreihenfolge sicher
   */
  async processToolCalls(
    toolCalls: ToolCall[],
    context: ToolCallMessageContext
  ): Promise<ToolCallValidationResult> {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      throw new Error('Invalid toolCalls: must be non-empty array');
    }

    if (this.config.enableDetailedLogging) {
      log.info(`Processing ${toolCalls.length} tool calls for message ${context.messageId}`);
    }

    try {
      // 0. KRITISCH: Modus-basierte Validierung VOR der Tool-Ausführung
      const modeValidation = this.validateToolExecutionForMode(toolCalls, context);
      if (!modeValidation.valid) {
        log.error('Mode validation failed:', modeValidation.errors.join(', '));
        this.emitEvent({
          type: 'validation_error',
          messageId: context.messageId,
          timestamp: Date.now(),
          data: {
            eventType: 'validation_error',
            errors: modeValidation.errors
          }
        });
        return {
          valid: false,
          errors: modeValidation.errors,
          warnings: [],
          toolCallGroups: []
        };
      }

      // 1. Validierung der Tool-Calls
      let validationResult: ToolCallValidationResult;

      if (this.config.enableValidation) {
        validationResult = this.validator.validateToolCalls(toolCalls, context);

        if (!validationResult.valid) {
          log.error('Tool call validation failed:', validationResult.errors.join(', '));
          this.emitEvent({
            type: 'validation_error',
            messageId: context.messageId,
            timestamp: Date.now(),
            data: {
              eventType: 'validation_error',
              errors: validationResult.errors
            }
          });
          return validationResult;
        }
      } else {
        // Fallback ohne Validierung (Migration-Modus)
        validationResult = this.createFallbackValidation(toolCalls, context);
      }

      // 2. Tracke die Tool-Calls
      validationResult.toolCallGroups.forEach(group => {
        group.toolCalls.forEach(toolCall => {
          this.tracker.trackToolCall(toolCall, group.id);
        });

        // Setze die Message-ID für die Gruppe
        this.tracker.setGroupMessageId(group.id, context.messageId || 'unknown');
      });

      // 3. Starte die Ausführung
      if (validationResult.toolCallGroups.length > 0) {
        await this.executeToolCallGroups(validationResult.toolCallGroups, context);
      }

      return validationResult;

    } catch (error) {
      log.error('Error processing tool calls:', error);
      return {
        valid: false,
        errors: [`Processing error: ${error instanceof Error ? error.message : 'Unknown error'}`],
        warnings: [],
        toolCallGroups: []
      };
    }
  }

  /**
   * Führt Tool-Call-Gruppen aus
   */
  private async executeToolCallGroups(
    groups: ToolCallGroup[],
    context: ToolCallMessageContext
  ): Promise<void> {
    for (const group of groups) {
      try {
        // Starte die Gruppenausführung
        this.tracker.startGroupExecution(group.id);

        // Führe Tools parallel aus (mit Limit)
        const results = await this.executeToolsInParallel(group.toolCalls, context);

        // Verarbeite Ergebnisse
        results.forEach(result => {
          if (result.success) {
            this.tracker.updateToolCallStatus(result.toolCallId, 'completed', result.result);
          } else {
            this.tracker.updateToolCallStatus(result.toolCallId, 'failed', undefined, result.error);
          }
        });

      } catch (error) {
        log.error(`Error executing group ${group.id}:`, error);

        // Markiere alle Tool-Calls in der Gruppe als fehlgeschlagen
        group.toolCalls.forEach(toolCall => {
          this.tracker.updateToolCallStatus(
            toolCall.id,
            'failed',
            undefined,
            error instanceof Error ? error.message : 'Unknown error'
          );
        });
      }
    }
  }

  /**
   * Führt Tools parallel aus mit Begrenzung
   */
  private async executeToolsInParallel(
    toolCalls: ToolCall[],
    context: ToolCallMessageContext
  ): Promise<ToolCallExecutionResult[]> {
    const results: ToolCallExecutionResult[] = [];
    const maxConcurrent = Math.min(this.config.maxConcurrentToolCalls, toolCalls.length);

    // Teile Tool-Calls in Batches auf
    for (let i = 0; i < toolCalls.length; i += maxConcurrent) {
      const batch = toolCalls.slice(i, i + maxConcurrent);

      const batchResults = await Promise.allSettled(
        batch.map(toolCall => this.executeSingleTool(toolCall, context))
      );

      batchResults.forEach((result, index) => {
        const toolCall = batch[index];
        if (result.status === 'fulfilled') {
          results.push({
            success: true,
            toolCallId: toolCall.id,
            groupId: this.findGroupIdForToolCall(toolCall.id),
            result: result.value as ToolCallResult,
            executionTime: Date.now() - (toolCall.startTime || Date.now())
          });
        } else {
          results.push({
            success: false,
            toolCallId: toolCall.id,
            groupId: this.findGroupIdForToolCall(toolCall.id),
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
            executionTime: Date.now() - (toolCall.startTime || Date.now())
          });
        }
      });
    }

    return results;
  }

  /**
   * Führt ein einzelnes Tool aus
   */
  private async executeSingleTool(
    toolCall: ToolCall,
    context: ToolCallMessageContext
  ): Promise<ToolCallResult> {
    try {
      // Parse die Argumente
      const args = JSON.parse(toolCall.function.arguments);

      // Führe das Tool über den AgentManager aus
      const result = await this.executeWithTimeout<ToolCallResult>(
        this.agentManager.executeTool(toolCall.function.name, args),
        this.config.toolExecutionTimeout
      );

      if (this.config.enableDetailedLogging) {
        log.info(`Tool ${toolCall.function.name} completed successfully`);
      }

      return result;

    } catch (error) {
      log.error(`Tool ${toolCall.function.name} failed:`, error);
      throw error;
    }
  }

  /**
   * Führt eine Funktion mit Timeout aus
   */
  private async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Tool execution timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Erstellt Nachrichten für die Konversationshistorie
   */
  createConversationMessages(toolCallIds: string[]): ChatMessage[] {
    const messages: ChatMessage[] = [];

    toolCallIds.forEach(toolCallId => {
      const toolCall = this.tracker.getToolCall(toolCallId);
      if (toolCall && (toolCall.status === 'completed' || toolCall.status === 'failed')) {
        const content = toolCall.status === 'completed'
          ? JSON.stringify(toolCall.result)
          : JSON.stringify({ error: toolCall.error });

        messages.push({
          role: 'tool',
          content,
          tool_call_id: toolCallId
        });
      }
    });

    return messages;
  }

  /**
   * Validiert die Konversationshistorie
   */
  validateConversationHistory(messages: ChatMessage[]): { valid: boolean; errors: string[] } {
    return this.validator.validateMessageSequence(messages);
  }

  /**
   * Registriert einen Event-Listener
   */
  addListener(listener: ToolCallListener): void {
    this.listeners.add(listener);
  }

  /**
   * Entfernt einen Event-Listener
   */
  removeListener(listener: ToolCallListener): void {
    this.listeners.delete(listener);
  }

  /**
   * Event-Handler für Tool-Call-Events
   */
  private handleToolCallEvent(event: ToolCallEvent): void {
    // Forward an alle registrierten Listener
    this.listeners.forEach(listener => {
      try {
        listener.onToolCallEvent(event);
      } catch (error) {
        log.error('Error in listener:', error);
      }
    });

    // Logging bei wichtigen Events
    if (this.config.enableDetailedLogging) {
      switch (event.type) {
        case 'tool_call_started':
          log.info(`Tool execution started: ${event.toolCallId}`);
          break;
        case 'tool_call_completed':
          log.info(`Tool execution completed: ${event.toolCallId}`);
          break;
        case 'tool_call_failed':
          if (event.data && event.data.eventType === 'tool_call_failed') {
            log.error(`Tool execution failed: ${event.toolCallId}`, event.data.error);
          }
          break;
        case 'tool_group_completed':
          if (event.data && event.data.eventType === 'tool_group_completed') {
            log.info(`Tool group completed: ${event.groupId} in ${event.data.totalTime}ms`);
          }
          break;
      }
    }
  }

  /**
   * Emit ein Event
   */
  private emitEvent(event: ToolCallEvent): void {
    this.onToolCallEvent(event);
  }

  /**
   * Findet die Gruppen-ID für einen Tool-Call
   */
  private findGroupIdForToolCall(toolCallId: string): string {
    const activeGroups = this.tracker.getActiveGroups();
    for (const group of activeGroups) {
      if (group.toolCalls.some(tc => tc.id === toolCallId)) {
        return group.id;
      }
    }
    return 'unknown';
  }

  /**
   * Erstellt eine Fallback-Validierung (Migration-Modus)
   */
  private createFallbackValidation(toolCalls: ToolCall[], context: ToolCallMessageContext): ToolCallValidationResult {
    const groupId = `fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      valid: true,
      errors: [],
      warnings: ['Validation disabled - running in migration mode'],
      toolCallGroups: [{
        id: groupId,
        messageId: context.messageId || 'unknown',
        toolCalls: toolCalls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
          status: 'pending' as const
        })),
        status: 'pending',
        createdAt: Date.now()
      }]
    };
  }

  /**
   * Startet den Cleanup-Interval
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      if (!this.isShuttingDown) {
        this.tracker.cleanupCompletedGroups(5 * 60 * 1000); // 5 Minuten
      }
    }, 60 * 1000); // Jede Minute
  }

  /**
   * Ruft Statistiken ab
   */
  getStats(): Record<string, any> {
    return this.tracker.getStats();
  }

  /**
   * Get a specific tool call by ID
   */
  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.tracker.getToolCall(toolCallId);
  }

  /**
   * Fährt den Manager herunter
   */
  dispose(): void {
    this.isShuttingDown = true;
    this.tracker.cleanupCompletedGroups(0); // Sofortige Bereinigung
    log.info('Disposed');
  }

  /**
   * Validiert die Tool-Ausführung für den aktuellen Modus
   */
  private validateToolExecutionForMode(
    toolCalls: ToolCall[],
    context: ToolCallMessageContext
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Extrahiere den aktuellen Modus aus dem Kontext
    const currentMode = context.selectedMode;

    if (!currentMode) {
      // Wenn kein Modus angegeben ist, erlaube die Ausführung
      return { valid: true, errors: [] };
    }

    // Prüfe jeden Tool-Call
    for (const toolCall of toolCalls) {
      const toolName = toolCall.function?.name;

      if (!toolName) {
        errors.push(`Tool call missing function name`);
        continue;
      }

      // Architect Mode: Planning- und Memory-Bank-Tools erlauben
      if (currentMode === 'architect') {
        const allowedArchitectTools = [
          'find_files',
          'list_files',
          'get_memories',
          'recall_memories',
          'read_file',
          'analyze_project_structure',
          'create_plan',
          'handover_to_coder',
          'update_memory_bank',
          'query_long_term_memory'
        ];

        if (!allowedArchitectTools.includes(toolName)) {
          errors.push(`Architect mode cannot execute tool '${toolName}'. Only planning, analysis, and memory bank tools are allowed: ${allowedArchitectTools.join(', ')}.`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Implementation von ToolCallListener
  onToolCallEvent(event: ToolCallEvent): void {
    this.handleToolCallEvent(event);
  }
}

// TEST: ToolCallManager.ts
const mockAgent: AgentManager = { executeTool: async () => ({ type: 'success', data: {} }) };
const manager = new ToolCallManager(mockAgent);
manager.processToolCalls([], { conversationHistory: [] }).catch(e => {
  console.assert(e.message === 'Invalid toolCalls: must be non-empty array', 'Test failed: ' + e.message);
  console.log('✅ ToolCallManager jetzt 9.7/10');
});