// =====================================================
// Chat Session Provider - Chat session management
// =====================================================

import { v4 as uuidv4 } from 'uuid';
import {
  ChatSession,
  ChatMessage,
  SessionProvider,
  SessionType,
  SessionStatus
} from '../types/SessionTypes';
import { ISessionStorage } from '../storage/types/StorageTypes';
import { sessionCache } from '../../performance/cache';

/**
 * Chat session provider implementation
 */
export class ChatSessionProvider implements SessionProvider<ChatSession> {
  constructor(private storage: ISessionStorage) {}

  /**
   * Create a new chat session
   */
  async createSession(data: {
    name?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  } = {}): Promise<ChatSession> {
    const now = Date.now();
    const session: ChatSession = {
      id: uuidv4(),
      type: SessionType.CHAT,
      name: data.name || 'New Chat',
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      status: SessionStatus.ACTIVE,
      metadata: {
        agentMode: false,
        isPinned: false
      },
      messages: [],
      model: data.model || 'deepseek-chat',
      temperature: data.temperature || 0.7,
      maxTokens: data.maxTokens || 4000
    };

    await this.storage.saveSession(session);
    console.log(`[ChatSessionProvider] Created chat session: ${session.id}`);
    return session;
  }

  /**
   * Get a chat session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const session = await this.storage.loadSession(sessionId);
    if (!session || session.type !== SessionType.CHAT) {
      return null;
    }
    return session as ChatSession;
  }

  /**
   * Update a chat session
   */
  async updateSession(sessionId: string, updates: Partial<ChatSession>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    // Apply updates
    Object.assign(session, updates);
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    console.log(`[ChatSessionProvider] Updated chat session: ${sessionId}`);
  }

  /**
   * Delete a chat session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    await this.storage.deleteSession(sessionId);
    console.log(`[ChatSessionProvider] Deleted chat session: ${sessionId}`);
  }

  /**
   * Get all chat sessions
   */
  async getAllSessions(): Promise<ChatSession[]> {
    const sessions = await this.storage.getSessionsByType(SessionType.CHAT);
    return sessions as ChatSession[];
  }

  /**
   * Validate a chat session
   */
  validateSession(session: ChatSession): boolean {
    // Check required fields
    if (!session.id || !session.type || session.type !== SessionType.CHAT) {
      return false;
    }

    // Check message structure
    if (!Array.isArray(session.messages)) {
      return false;
    }

    for (const message of session.messages) {
      if (!message.id || !message.sessionId || !message.role || !message.content) {
        return false;
      }

      if (!['user', 'assistant', 'system'].includes(message.role)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Export a chat session
   */
  exportSession(session: ChatSession): string {
    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      session: {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        model: session.model,
        temperature: session.temperature,
        maxTokens: session.maxTokens,
        messages: session.messages
      }
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import a chat session
   */
  importSession(data: string): ChatSession {
    try {
      const importData = JSON.parse(data);
      
      if (!importData.version || !importData.session) {
        throw new Error('Invalid export format');
      }

      const sessionData = importData.session;
      const now = Date.now();
      
      const session: ChatSession = {
        id: uuidv4(), // Generate new ID to avoid conflicts
        type: SessionType.CHAT,
        name: sessionData.name || `Imported Chat ${new Date().toLocaleString()}`,
        createdAt: sessionData.createdAt || now,
        updatedAt: now,
        lastAccessedAt: now,
        status: SessionStatus.ACTIVE,
        metadata: {
          importedAt: now,
          originalId: sessionData.id
        },
        messages: sessionData.messages || [],
        model: sessionData.model || 'gpt-3.5-turbo',
        temperature: sessionData.temperature || 0.7,
        maxTokens: sessionData.maxTokens || 2048
      };

      // Validate imported session
      if (!this.validateSession(session)) {
        throw new Error('Invalid session data');
      }

      return session;
    } catch (error) {
      console.error('[ChatSessionProvider] Error importing session:', error);
      throw new Error(`Failed to import session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add a message to a chat session
   */
  async addMessage(sessionId: string, message: {
    role: 'user' | 'assistant' | 'system' | 'command-approval' | 'tool-execution';
    content: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    // Create message with all possible fields
    const chatMessage: ChatMessage = {
      id: uuidv4(),
      sessionId,
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
      metadata: message.metadata || {}
    };

    // Handle different message types
    if (message.role === 'command-approval' && message.metadata?.commandApproval) {
      // Store command approval data directly in the message
      chatMessage.commandApproval = message.metadata.commandApproval;
    } else if (message.role === 'tool-execution' && message.metadata?.toolExecution) {
      // Store tool execution data directly in the message
      chatMessage.toolExecution = message.metadata.toolExecution;
    } else if (message.role === 'system' && message.metadata?.isSystemMessage) {
      // Store system message flag directly in the message
      chatMessage.isSystemMessage = message.metadata.isSystemMessage;
    }

    // Store file references and tool calls if present
    if (message.metadata?.fileReferences) {
      chatMessage.fileReferences = message.metadata.fileReferences;
    }
    if (message.metadata?.toolCalls) {
      chatMessage.toolCalls = message.metadata.toolCalls;
    }
    if (message.metadata?.checkpoint) {
      chatMessage.checkpoint = message.metadata.checkpoint;
    }

    session.messages.push(chatMessage);
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();
    
    // Auto-generate title from first user message
    if (session.messages.length === 1 && message.role === 'user') {
      const content = message.content.trim();
      session.name = content.length > 50 ? content.substring(0, 50) + '...' : content;
    }

    await this.storage.saveSession(session);
    
    // Invalidate cache for this session
    const cacheKey = `session:${sessionId}`;
    sessionCache.delete(cacheKey);
    sessionCache.delete(`sessions:chat`);
    sessionCache.delete('sessions:all');
    console.log(`[ChatSessionProvider] Invalidated cache for session: ${sessionId}`);
    
    console.log(`[ChatSessionProvider] Added ${message.role} message to session: ${sessionId}`);
  }

  /**
   * Get chat history for a session
   */
  async getChatHistory(sessionId: string): Promise<ChatMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    return [...session.messages];
  }

  /**
   * Clear chat history for a session
   */
  async clearHistory(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    session.messages = [];
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    console.log(`[ChatSessionProvider] Cleared history for session: ${sessionId}`);
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string): Promise<{
    messageCount: number;
    totalTokens: number;
    averageResponseTime: number;
  }> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    const messageCount = session.messages.length;
    let totalTokens = 0;
    let totalResponseTime = 0;
    let responseCount = 0;

    for (let i = 0; i < session.messages.length; i++) {
      const message = session.messages[i];
      
      // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
      totalTokens += Math.ceil(message.content.length / 4);

      // Calculate response times
      if (message.role === 'assistant' && i > 0 && session.messages[i - 1].role === 'user') {
        const responseTime = message.timestamp - session.messages[i - 1].timestamp;
        totalResponseTime += responseTime;
        responseCount++;
      }
    }

    return {
      messageCount,
      totalTokens,
      averageResponseTime: responseCount > 0 ? totalResponseTime / responseCount : 0
    };
  }

  /**
   * Add a command approval message to a chat session
   */
  async addCommandApprovalMessage(sessionId: string, commandApproval: {
    commandId: string;
    command: string;
    cwd: string;
    reason: string;
    safetyLevel: 'safe' | 'moderate' | 'risky';
    status: 'pending' | 'approved' | 'rejected';
  }): Promise<void> {
    await this.addMessage(sessionId, {
      role: 'command-approval',
      content: commandApproval.command,
      metadata: {
        commandApproval
      }
    });
  }

  /**
   * Add a tool execution message to a chat session
   */
  async addToolExecutionMessage(sessionId: string, toolExecution: {
    toolName: string;
    isExecuting: boolean;
    startTime: number;
    endTime?: number;
    duration?: number;
    fileName?: string;
    diffStats?: { added: number; deleted: number };
  }): Promise<void> {
    await this.addMessage(sessionId, {
      role: 'tool-execution',
      content: toolExecution.toolName,
      metadata: {
        toolExecution
      }
    });
  }

  /**
   * Add a system message to a chat session
   */
  async addSystemMessage(sessionId: string, content: string): Promise<void> {
    await this.addMessage(sessionId, {
      role: 'system',
      content,
      metadata: {
        isSystemMessage: true
      }
    });
  }

  /**
   * Update a command approval message in a chat session
   */
  async updateCommandApprovalMessage(sessionId: string, commandId: string, status: 'approved' | 'rejected'): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    // Find the command approval message
    const messageIndex = session.messages.findIndex(msg =>
      msg.role === 'command-approval' && msg.commandApproval?.commandId === commandId
    );

    if (messageIndex === -1) {
      throw new Error(`Command approval message not found: ${commandId}`);
    }

    // Update the status
    session.messages[messageIndex].commandApproval!.status = status;
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    
    // Invalidate cache for this session
    sessionCache.delete(`session:${sessionId}`);
    sessionCache.delete(`sessions:chat`);
    sessionCache.delete('sessions:all');
    
    console.log(`[ChatSessionProvider] Updated command approval message: ${commandId} to ${status}`);
  }

  /**
   * Update a tool execution message in a chat session
   */
  async updateToolExecutionMessage(sessionId: string, toolName: string, updates: {
    isExecuting?: boolean;
    endTime?: number;
    duration?: number;
    fileName?: string;
    diffStats?: { added: number; deleted: number };
  }): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    // Find the most recent tool execution message for this tool
    const messageIndex = session.messages.slice().reverse().findIndex(msg =>
      msg.role === 'tool-execution' && msg.toolExecution?.toolName === toolName
    );

    if (messageIndex === -1) {
      throw new Error(`Tool execution message not found: ${toolName}`);
    }

    const actualIndex = session.messages.length - 1 - messageIndex;

    // Update the tool execution data
    if (updates.isExecuting !== undefined) {
      session.messages[actualIndex].toolExecution!.isExecuting = updates.isExecuting;
    }
    if (updates.endTime !== undefined) {
      session.messages[actualIndex].toolExecution!.endTime = updates.endTime;
    }
    if (updates.duration !== undefined) {
      session.messages[actualIndex].toolExecution!.duration = updates.duration;
    }
    if (updates.fileName !== undefined) {
      session.messages[actualIndex].toolExecution!.fileName = updates.fileName;
    }
    if (updates.diffStats !== undefined) {
      session.messages[actualIndex].toolExecution!.diffStats = updates.diffStats;
    }

    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    
    // Invalidate cache for this session
    sessionCache.delete(`session:${sessionId}`);
    sessionCache.delete(`sessions:chat`);
    sessionCache.delete('sessions:all');
    
    console.log(`[ChatSessionProvider] Updated tool execution message: ${toolName}`);
  }
}