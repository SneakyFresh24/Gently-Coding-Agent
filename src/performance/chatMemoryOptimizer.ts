// =====================================================
// Chat Memory Optimizer - Memory optimization for chat history
// =====================================================

import { Disposable } from 'vscode';
import { chatCache } from './cache';

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  weight?: number; // Numeric weighting for 2026 standards
  important?: boolean;
  metadata?: any;
}

/**
 * Chat session interface
 */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastActivity: number;
  metadata?: any;
}

/**
 * Chat compaction options
 */
export interface ChatCompactionOptions {
  /** Maximum messages to keep per session */
  maxMessages?: number;
  /** Whether to keep important messages regardless of limit */
  keepImportantMessages?: boolean;
  /** Age threshold in days for old messages */
  ageThreshold?: number;
  /** Whether to compress message content */
  compressContent?: boolean;
  /** Whether to merge consecutive messages from same role */
  mergeConsecutiveMessages?: boolean;
}

/**
 * Chat memory statistics
 */
export interface ChatMemoryStats {
  /** Total number of sessions */
  totalSessions: number;
  /** Total number of messages */
  totalMessages: number;
  /** Total memory usage in MB */
  totalMemoryUsage: number;
  /** Average messages per session */
  avgMessagesPerSession: number;
  /** Number of compacted sessions */
  compactedSessions: number;
}

/**
 * Chat memory optimizer
 */
export class ChatMemoryOptimizer implements Disposable {
  private disposables: Disposable[] = [];
  private defaultOptions: ChatCompactionOptions = {
    maxMessages: 100,
    keepImportantMessages: true,
    ageThreshold: 30,
    compressContent: false,
    mergeConsecutiveMessages: true
  };

  constructor() {
    console.log('[ChatMemoryOptimizer] Initialized');
  }

  /**
   * Optimize chat session memory
   */
  async optimizeSession(session: ChatSession, options: ChatCompactionOptions = {}): Promise<ChatSession> {
    const opts = { ...this.defaultOptions, ...options };
    console.log(`[ChatMemoryOptimizer] Optimizing session: ${session.id}`);

    // Create a copy of the session to avoid modifying the original
    const optimizedSession: ChatSession = {
      ...session,
      messages: [...session.messages]
    };

    // Apply optimizations in order
    optimizedSession.messages = this.removeOldMessages(optimizedSession.messages, opts);
    optimizedSession.messages = this.limitMessageCount(optimizedSession.messages, opts);
    optimizedSession.messages = this.mergeConsecutiveMessages(optimizedSession.messages, opts);

    if (opts.compressContent) {
      optimizedSession.messages = this.compressMessageContent(optimizedSession.messages);
    }

    console.log(`[ChatMemoryOptimizer] Session optimized: ${session.messages.length} → ${optimizedSession.messages.length} messages`);
    return optimizedSession;
  }

  /**
   * Remove old messages based on age threshold
   */
  private removeOldMessages(messages: ChatMessage[], options: ChatCompactionOptions): ChatMessage[] {
    if (!options.ageThreshold) {
      return messages;
    }

    const cutoffTime = Date.now() - (options.ageThreshold * 24 * 60 * 60 * 1000);

    return messages.filter(message => {
      // Keep important messages regardless of age
      if (options.keepImportantMessages && message.important) {
        return true;
      }

      // Keep system messages regardless of age
      if (message.role === 'system') {
        return true;
      }

      // Keep recent messages
      return message.timestamp >= cutoffTime;
    });
  }

  /**
   * Limit message count while preserving important and high-weight messages
   */
  private limitMessageCount(messages: ChatMessage[], options: ChatCompactionOptions): ChatMessage[] {
    if (!options.maxMessages || messages.length <= options.maxMessages) {
      return messages;
    }

    // Calculate survival score for each message
    // System messages always have max survival
    const scoredMessages = messages.map(m => {
      let score = 0;
      if (m.role === 'system') score = 999999;
      if (m.important) score += 1000;
      if (m.weight) score += m.weight * 100;

      // Age factor: more recent messages get a small boost
      const ageInHours = (Date.now() - m.timestamp) / (1000 * 60 * 60);
      score += Math.max(0, 100 - ageInHours);

      return { message: m, score };
    });

    // Sort by score descending and take the top N
    return scoredMessages
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxMessages)
      .map(item => item.message)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Merge consecutive messages from the same role
   */
  private mergeConsecutiveMessages(messages: ChatMessage[], options: ChatCompactionOptions): ChatMessage[] {
    if (!options.mergeConsecutiveMessages || messages.length === 0) {
      return messages;
    }

    const mergedMessages: ChatMessage[] = [];
    let currentMessage: ChatMessage | null = null;

    for (const message of messages) {
      if (!currentMessage) {
        currentMessage = { ...message };
        continue;
      }

      // Check if we can merge with the current message
      if (currentMessage.role === message.role &&
        !currentMessage.important &&
        !message.important &&
        message.timestamp - currentMessage.timestamp < 60000) { // Within 1 minute

        // Merge content
        currentMessage.content += '\n\n' + message.content;
        currentMessage.timestamp = message.timestamp; // Update to latest timestamp
      } else {
        // Can't merge, add current message and start a new one
        mergedMessages.push(currentMessage);
        currentMessage = { ...message };
      }
    }

    // Add the last message if it exists
    if (currentMessage) {
      mergedMessages.push(currentMessage);
    }

    return mergedMessages;
  }

  /**
   * Compress message content by removing redundant whitespace and normalizing
   */
  private compressMessageContent(messages: ChatMessage[]): ChatMessage[] {
    return messages.map(message => ({
      ...message,
      content: message.content
        .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
        .replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2 newlines
        .trim() // Remove leading/trailing whitespace
    }));
  }

  /**
   * Get memory usage statistics for chat sessions
   */
  getMemoryStats(sessions: ChatSession[]): ChatMemoryStats {
    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((sum, session) => sum + session.messages.length, 0);

    // Estimate memory usage (rough approximation)
    const avgMessageSize = 500; // bytes
    const totalMemoryUsage = Math.round((totalMessages * avgMessageSize) / 1024 / 1024 * 100) / 100; // MB

    const avgMessagesPerSession = totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0;

    return {
      totalSessions,
      totalMessages,
      totalMemoryUsage,
      avgMessagesPerSession,
      compactedSessions: 0 // Would need to be tracked during optimization
    };
  }

  /**
   * Cache a chat session
   */
  cacheSession(session: ChatSession, ttl?: number): void {
    const cacheKey = `chatSession:${session.id}`;
    chatCache.set(cacheKey, session, ttl);
  }

  /**
   * Get a cached chat session
   */
  getCachedSession(sessionId: string): ChatSession | null {
    const cacheKey = `chatSession:${sessionId}`;
    return chatCache.get(cacheKey) || null;
  }

  /**
   * Remove a session from cache
   */
  uncacheSession(sessionId: string): void {
    const cacheKey = `chatSession:${sessionId}`;
    chatCache.delete(cacheKey);
  }

  /**
   * Create a summary of a chat session
   */
  createSummary(session: ChatSession): string {
    if (session.messages.length === 0) {
      return 'Empty session';
    }

    // Get user and assistant messages
    const userMessages = session.messages.filter(m => m.role === 'user');
    const assistantMessages = session.messages.filter(m => m.role === 'assistant');

    // Create summary
    const summaryParts = [
      `${session.messages.length} messages`,
      `${userMessages.length} from user`,
      `${assistantMessages.length} from assistant`
    ];

    if (session.lastActivity) {
      const lastActivityDate = new Date(session.lastActivity);
      summaryParts.push(`Last active: ${lastActivityDate.toLocaleDateString()}`);
    }

    return summaryParts.join(' • ');
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    // Clear all disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];

    console.log('[ChatMemoryOptimizer] Disposed');
  }
}

// Global chat memory optimizer instance
export const chatMemoryOptimizer = new ChatMemoryOptimizer();