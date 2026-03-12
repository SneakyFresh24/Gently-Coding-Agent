// =====================================================
// Chat Message Utilities
// =====================================================

import { ChatMessage } from '../../../services/OpenRouterService';
import { Message } from '../types/ChatTypes';

export class ChatMessageUtils {
  /**
   * Convert between different message formats
   */
  static convertToUIMessage(chatMessage: ChatMessage): Message {
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: chatMessage.role === 'tool' ? 'assistant' : chatMessage.role, // Convert 'tool' to 'assistant' for UI
      content: chatMessage.content,
      timestamp: Date.now(),
      toolCalls: chatMessage.tool_calls,
    };
  }

  /**
   * Filter messages for LLM context
   */
  static filterForLLMContext(messages: Message[]): ChatMessage[] {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        tool_calls: m.toolCalls
      }));
  }

  /**
   * Generate a unique message ID
   */
  static generateMessageId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if a message is a system message
   */
  static isSystemMessage(message: Message): boolean {
    return message.role === 'system' || message.isSystemMessage === true;
  }

  /**
   * Check if a message is from the user
   */
  static isUserMessage(message: Message): boolean {
    return message.role === 'user';
  }

  /**
   * Check if a message is from the assistant
   */
  static isAssistantMessage(message: Message): boolean {
    return message.role === 'assistant';
  }

  /**
   * Check if a message has tool calls
   */
  static hasToolCalls(message: Message): boolean {
    return !!(message.toolCalls && message.toolCalls.length > 0);
  }

  /**
   * Get the content preview of a message
   */
  static getContentPreview(message: Message, maxLength: number = 100): string {
    const content = message.content || '';
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...';
  }

  /**
   * Format message timestamp
   */
  static formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Group messages by date
   */
  static groupMessagesByDate(messages: Message[]): { [date: string]: Message[] } {
    const groups: { [date: string]: Message[] } = {};

    messages.forEach(message => {
      const date = new Date(message.timestamp).toDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
    });

    return groups;
  }

  /**
   * Count messages by type
   */
  static countMessagesByType(messages: Message[]): { [type: string]: number } {
    const counts: { [type: string]: number } = {};

    messages.forEach(message => {
      counts[message.role] = (counts[message.role] || 0) + 1;
    });

    return counts;
  }

  /**
   * Get the last user message
   */
  static getLastUserMessage(messages: Message[]): Message | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i];
      }
    }
    return null;
  }

  /**
   * Get the last assistant message
   */
  static getLastAssistantMessage(messages: Message[]): Message | null {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        return messages[i];
      }
    }
    return null;
  }

  /**
   * Check if message contains file references
   */
  static hasFileReferences(message: Message): boolean {
    return !!(message.fileReferences && message.fileReferences.length > 0);
  }

  /**
   * Get total file size from message
   */
  static getTotalFileSize(message: Message): number {
    if (!message.fileReferences) {
      return 0;
    }

    return message.fileReferences.reduce((total, ref) => {
      return total + (ref.size || 0);
    }, 0);
  }
}