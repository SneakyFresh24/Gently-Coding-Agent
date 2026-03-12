// =====================================================
// Tool Call Tracker - Verwaltung des Tool-Call-Lebenszyklus
// =====================================================

import {
  ToolCall,
  ToolCallGroup,
  ToolCallTracker as IToolCallTracker,
  ToolCallEvent,
  ToolCallEventType,
  ToolCallResult
} from './types/ToolCallTypes';

export class ToolCallTracker implements IToolCallTracker {
  private toolCalls: Map<string, ToolCall> = new Map();
  private toolGroups: Map<string, ToolCallGroup> = new Map();
  private listeners: Set<(event: ToolCallEvent) => void> = new Set();

  /**
   * Registriert einen Tool-Call und weist ihn einer Gruppe zu
   */
  trackToolCall(toolCall: ToolCall, groupId: string): void {
    // Setze Zeitstempel für den Start
    toolCall.startTime = Date.now();

    // Speichere den Tool-Call
    this.toolCalls.set(toolCall.id, toolCall);

    // Füge zur Gruppe hinzu oder erstelle neue Gruppe
    let group = this.toolGroups.get(groupId);
    if (!group) {
      group = {
        id: groupId,
        messageId: toolCall.id, // Wird später aktualisiert
        toolCalls: [],
        status: 'pending',
        createdAt: Date.now()
      };
      this.toolGroups.set(groupId, group);
    }

    group.toolCalls.push(toolCall);

    // Emit Event
    this.emitEvent({
      type: 'tool_calls_received',
      toolCallId: toolCall.id,
      groupId: groupId,
      timestamp: Date.now(),
      data: {
        eventType: 'tool_calls_received',
        toolCalls: [toolCall]
      }
    });
  }

  /**
   * Aktualisiert den Status eines Tool-Calls
   */
  updateToolCallStatus(toolCallId: string, status: ToolCall['status'], result?: ToolCallResult, error?: string): void {
    const toolCall = this.toolCalls.get(toolCallId);
    if (!toolCall) {
      console.warn(`[ToolCallTracker] Tool call not found: ${toolCallId}`);
      return;
    }

    const previousStatus = toolCall.status;
    toolCall.status = status;

    if (result !== undefined) {
      toolCall.result = result;
    }

    if (error !== undefined) {
      toolCall.error = error;
    }

    // Berechne Ausführungszeit bei Abschluss
    if (status === 'completed' || status === 'failed') {
      toolCall.endTime = Date.now();
      toolCall.executionTime = toolCall.endTime - (toolCall.startTime || toolCall.endTime);
    }

    // Finde die Gruppe und aktualisiere deren Status
    this.updateGroupStatus(toolCall);

    // Emit Events
    this.emitToolCallStatusEvent(toolCall, previousStatus);
  }

  /**
   * Ruft einen spezifischen Tool-Call ab
   */
  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.toolCalls.get(toolCallId);
  }

  /**
   * Ruft eine Tool-Call-Gruppe ab
   */
  getToolGroup(groupId: string): ToolCallGroup | undefined {
    return this.toolGroups.get(groupId);
  }

  /**
   * Ruft alle aktiven Gruppen ab
   */
  getActiveGroups(): ToolCallGroup[] {
    return Array.from(this.toolGroups.values()).filter(
      group => group.status === 'pending' || group.status === 'executing'
    );
  }

  /**
   * Räumt abgeschlossene Gruppen auf
   */
  cleanupCompletedGroups(maxAge: number): void {
    const now = Date.now();
    const groupsToRemove: string[] = [];

    this.toolGroups.forEach((group, groupId) => {
      if (group.status === 'completed' || group.status === 'failed') {
        const age = now - (group.completedAt || group.createdAt);
        if (age > maxAge) {
          groupsToRemove.push(groupId);
        }
      }
    });

    // Entferne Gruppen und ihre Tool-Calls
    groupsToRemove.forEach(groupId => {
      const group = this.toolGroups.get(groupId);
      if (group) {
        // Entferne Tool-Calls aus der globalen Map
        group.toolCalls.forEach(toolCall => {
          this.toolCalls.delete(toolCall.id);
        });

        // Entferne die Gruppe
        this.toolGroups.delete(groupId);
      }
    });

    if (groupsToRemove.length > 0) {
      console.log(`[ToolCallTracker] Cleaned up ${groupsToRemove.length} completed groups`);
    }
  }

  /**
   * Registriert einen Event-Listener
   */
  addListener(listener: (event: ToolCallEvent) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Entfernt einen Event-Listener
   */
  removeListener(listener: (event: ToolCallEvent) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Ruft Statistiken ab
   */
  getStats(): {
    totalToolCalls: number;
    activeToolCalls: number;
    completedToolCalls: number;
    failedToolCalls: number;
    totalGroups: number;
    activeGroups: number;
  } {
    const toolCalls = Array.from(this.toolCalls.values());
    const groups = Array.from(this.toolGroups.values());

    return {
      totalToolCalls: toolCalls.length,
      activeToolCalls: toolCalls.filter(tc => tc.status === 'pending' || tc.status === 'executing').length,
      completedToolCalls: toolCalls.filter(tc => tc.status === 'completed').length,
      failedToolCalls: toolCalls.filter(tc => tc.status === 'failed').length,
      totalGroups: groups.length,
      activeGroups: groups.filter(g => g.status === 'pending' || g.status === 'executing').length
    };
  }

  /**
   * Setzt den Message-ID für eine Gruppe
   */
  setGroupMessageId(groupId: string, messageId: string): void {
    const group = this.toolGroups.get(groupId);
    if (group) {
      group.messageId = messageId;
    }
  }

  /**
   * Startet die Ausführung einer Gruppe
   */
  startGroupExecution(groupId: string): void {
    const group = this.toolGroups.get(groupId);
    if (group && group.status === 'pending') {
      group.status = 'executing';

      // Setze alle Tool-Calls auf 'executing'
      group.toolCalls.forEach(toolCall => {
        if (toolCall.status === 'pending') {
          this.updateToolCallStatus(toolCall.id, 'executing');
        }
      });

      const toolCall = group.toolCalls[0];
      this.emitEvent({
        type: 'tool_call_started',
        groupId: groupId,
        timestamp: Date.now(),
        data: {
          eventType: 'tool_call_started',
          toolCallId: toolCall?.id || groupId,
          toolName: toolCall?.function.name || 'unknown'
        }
      });
    }
  }

  /**
   * Aktualisiert den Gruppenstatus basierend auf den Tool-Call-Status
   */
  private updateGroupStatus(changedToolCall: ToolCall): void {
    // Finde die Gruppe des Tool-Calls
    let group: ToolCallGroup | undefined;
    for (const g of this.toolGroups.values()) {
      if (g.toolCalls.some(tc => tc.id === changedToolCall.id)) {
        group = g;
        break;
      }
    }

    if (!group) return;

    const statuses = group.toolCalls.map(tc => tc.status);
    const allCompleted = statuses.every(s => s === 'completed' || s === 'failed');
    const anyFailed = statuses.some(s => s === 'failed');

    if (allCompleted) {
      group.status = anyFailed ? 'failed' : 'completed';
      group.completedAt = Date.now();
      group.totalExecutionTime = group.completedAt - group.createdAt;

      this.emitEvent({
        type: 'tool_group_completed',
        groupId: group.id,
        messageId: group.messageId,
        timestamp: Date.now(),
        data: {
          eventType: 'tool_group_completed',
          groupId: group.id,
          totalTime: group.totalExecutionTime || 0,
          success: !anyFailed,
          toolCallIds: group.toolCalls.map(tc => tc.id)
        }
      });
    } else if (statuses.some(s => s === 'executing')) {
      group.status = 'executing';
    }
  }

  /**
   * Emit Tool-Call-Status-Events
   */
  private emitToolCallStatusEvent(toolCall: ToolCall, previousStatus: ToolCall['status']): void {
    const eventType = this.getEventTypeForStatus(toolCall.status);
    if (!eventType) return;

    switch (eventType) {
      case 'tool_call_started':
        this.emitEvent({
          type: eventType,
          toolCallId: toolCall.id,
          timestamp: Date.now(),
          data: {
            eventType: 'tool_call_started',
            toolCallId: toolCall.id,
            toolName: toolCall.function.name
          }
        });
        break;

      case 'tool_call_completed':
        this.emitEvent({
          type: eventType,
          toolCallId: toolCall.id,
          timestamp: Date.now(),
          data: toolCall.result ? {
            eventType: 'tool_call_completed',
            toolCallId: toolCall.id,
            result: toolCall.result
          } : undefined
        });
        break;

      case 'tool_call_failed':
        this.emitEvent({
          type: eventType,
          toolCallId: toolCall.id,
          timestamp: Date.now(),
          data: {
            eventType: 'tool_call_failed',
            toolCallId: toolCall.id,
            error: toolCall.error || 'Unknown error'
          }
        });
        break;
    }
  }

  /**
   * Bestimmt den Event-Typ basierend auf dem Status
   */
  private getEventTypeForStatus(status: ToolCall['status']): ToolCallEventType | null {
    switch (status) {
      case 'executing': return 'tool_call_started';
      case 'completed': return 'tool_call_completed';
      case 'failed': return 'tool_call_failed';
      default: return null;
    }
  }

  /**
   * Emit ein Event an alle Listener
   */
  private emitEvent(event: ToolCallEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[ToolCallTracker] Error in event listener:', error);
      }
    });
  }
}