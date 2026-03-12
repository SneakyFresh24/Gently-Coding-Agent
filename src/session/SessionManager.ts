// =====================================================
// Session Manager - Central session management
// =====================================================

import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  Session,
  SessionType,
  SessionStatus,
  SessionManager as ISessionManager
} from './types/SessionTypes';
import { SessionStorageImpl } from './storage/SessionStorage';
import { StorageConfig } from './storage/types/StorageTypes';
import { ChatSessionProvider } from './providers/ChatSessionProvider';
import { WorkspaceSessionProvider } from './providers/WorkspaceSessionProvider';
import { sessionCache } from '../performance/cache';
import { performanceOptimizer } from '../performance/performanceOptimizer';

/**
 * Session manager implementation
 */
export class SessionManager implements ISessionManager {
  private storage: SessionStorageImpl;
  private chatProvider: ChatSessionProvider;
  private workspaceProvider: WorkspaceSessionProvider;
  private activeSessions: Map<SessionType, string> = new Map();
  private disposed: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    // Initialize storage
    const storageConfig: StorageConfig = {
      storagePath: path.join(context.globalStorageUri.fsPath, 'sessions'),
      maxSessions: 100,
      sessionTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
      compressionEnabled: true,
      encryptionEnabled: false
    };

    this.storage = new SessionStorageImpl(storageConfig);

    // Initialize providers
    this.chatProvider = new ChatSessionProvider(this.storage);
    this.workspaceProvider = new WorkspaceSessionProvider(this.storage);

    console.log('[SessionManager] Initialized with modular architecture');
  }

  /**
   * Create a new session
   */
  async createSession(type: SessionType, data: any): Promise<Session> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    let session: Session;

    switch (type) {
      case SessionType.CHAT:
        session = await this.chatProvider.createSession(data);
        break;
      case SessionType.WORKSPACE:
        session = await this.workspaceProvider.createSession(data);
        break;
      default:
        throw new Error(`Unsupported session type: ${type}`);
    }

    // Set as active session for its type
    this.activeSessions.set(type, session.id);

    console.log(`[SessionManager] Created session: ${session.id} of type: ${type}`);
    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    // Check cache first
    const cacheKey = `session:${sessionId}`;
    const cachedSession = sessionCache.get(cacheKey);
    if (cachedSession) {
      return cachedSession;
    }

    // Try each provider
    const chatSession = await this.chatProvider.getSession(sessionId);
    if (chatSession) {
      sessionCache.set(cacheKey, chatSession);
      return chatSession;
    }

    const workspaceSession = await this.workspaceProvider.getSession(sessionId);
    if (workspaceSession) {
      sessionCache.set(cacheKey, workspaceSession);
      return workspaceSession;
    }

    return null;
  }

  /**
   * Update a session
   */
  async updateSession(sessionId: string, data: Partial<Session>): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    switch (session.type) {
      case SessionType.CHAT:
        await this.chatProvider.updateSession(sessionId, data as any);
        break;
      case SessionType.WORKSPACE:
        await this.workspaceProvider.updateSession(sessionId, data as any);
        break;
      default:
        throw new Error(`Unsupported session type: ${session.type}`);
    }

    // Invalidate cache
    sessionCache.delete(`session:${sessionId}`);
    sessionCache.delete(`sessions:${session.type}`);
    sessionCache.delete('sessions:all');

    console.log(`[SessionManager] Updated session: ${sessionId}`);
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    switch (session.type) {
      case SessionType.CHAT:
        await this.chatProvider.deleteSession(sessionId);
        break;
      case SessionType.WORKSPACE:
        await this.workspaceProvider.deleteSession(sessionId);
        break;
      default:
        throw new Error(`Unsupported session type: ${session.type}`);
    }

    // Remove from active sessions if it was active
    if (this.activeSessions.get(session.type) === sessionId) {
      this.activeSessions.delete(session.type);
    }

    // Invalidate cache
    sessionCache.delete(`session:${sessionId}`);
    sessionCache.delete(`sessions:${session.type}`);
    sessionCache.delete('sessions:all');

    console.log(`[SessionManager] Deleted session: ${sessionId}`);
  }

  /**
   * Get all sessions
   */
  async getAllSessions(): Promise<Session[]> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    // Check cache first
    const cacheKey = 'sessions:all';
    const cachedSessions = sessionCache.get(cacheKey);
    if (cachedSessions) {
      return cachedSessions;
    }

    const chatSessions = await this.chatProvider.getAllSessions();
    const workspaceSessions = await this.workspaceProvider.getAllSessions();

    const allSessions = [...chatSessions, ...workspaceSessions];
    sessionCache.set(cacheKey, allSessions);
    return allSessions;
  }

  /**
   * Get sessions by type
   */
  async getSessionsByType(type: SessionType): Promise<Session[]> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    // Check cache first
    const cacheKey = `sessions:${type}`;
    const cachedSessions = sessionCache.get(cacheKey);
    if (cachedSessions) {
      return cachedSessions;
    }

    let sessions: Session[];
    switch (type) {
      case SessionType.CHAT:
        sessions = await this.chatProvider.getAllSessions();
        break;
      case SessionType.WORKSPACE:
        sessions = await this.workspaceProvider.getAllSessions();
        break;
      default:
        throw new Error(`Unsupported session type: ${type}`);
    }

    sessionCache.set(cacheKey, sessions);
    return sessions;
  }

  /**
   * Get active session for a type
   */
  async getActiveSession(type: SessionType): Promise<Session | null> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    const sessionId = this.activeSessions.get(type);
    if (!sessionId) {
      return null;
    }

    return await this.getSession(sessionId);
  }

  /**
   * Set active session for a type
   */
  async setActiveSession(type: SessionType, sessionId: string): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.type !== type) {
      throw new Error(`Session type mismatch: expected ${type}, got ${session.type}`);
    }

    this.activeSessions.set(type, sessionId);
    console.log(`[SessionManager] Set active session: ${sessionId} for type: ${type}`);
  }

  /**
   * Save all sessions
   */
  async saveSessions(): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    // Sessions are automatically saved when modified, so this is a no-op
    console.log('[SessionManager] Sessions are automatically saved');
  }

  /**
   * Load all sessions
   */
  async loadSessions(): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    // Sessions are automatically loaded when accessed, so this is a no-op
    console.log('[SessionManager] Sessions are automatically loaded');
  }

  /**
   * Cleanup expired sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    console.log('[SessionManager] Cleaning up expired sessions...');

    // Compact storage
    await this.storage.compact();

    console.log('[SessionManager] Cleanup completed');
  }

  /**
   * Force refresh sessions from storage
   */
  async refreshSessions(): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    console.log('[SessionManager] Refreshing sessions from storage...');

    // Clear session cache
    sessionCache.clear();
    console.log('[SessionManager] Cleared session cache');

    // Force reload all providers
    await this.chatProvider.getAllSessions();
    await this.workspaceProvider.getAllSessions();

    console.log('[SessionManager] Sessions refreshed successfully');
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    console.log('[SessionManager] Disposing...');
    this.disposed = true;

    // Dispose all components
    this.storage.dispose();
    this.activeSessions.clear();
  }

  /**
   * Get chat provider
   */
  getChatProvider(): ChatSessionProvider {
    return this.chatProvider;
  }

  /**
   * Get workspace provider
   */
  getWorkspaceProvider(): WorkspaceSessionProvider {
    return this.workspaceProvider;
  }

  /**
   * Get storage
   */
  getStorage(): SessionStorageImpl {
    return this.storage;
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    sessionsByType: Record<SessionType, number>;
    activeSessions: number;
    storageStats: any;
  }> {
    const allSessions = await this.getAllSessions();
    const sessionsByType: Record<SessionType, number> = {
      [SessionType.CHAT]: 0,
      [SessionType.WORKSPACE]: 0
    };

    for (const session of allSessions) {
      sessionsByType[session.type]++;
    }

    const storageStats = await this.storage.getStats();

    return {
      totalSessions: allSessions.length,
      sessionsByType,
      activeSessions: this.activeSessions.size,
      storageStats
    };
  }

  /**
   * Optimize session performance
   */
  async optimizePerformance(): Promise<void> {
    if (this.disposed) {
      throw new Error('SessionManager has been disposed');
    }

    console.log('[SessionManager] Optimizing performance...');

    // Get performance stats
    const stats = performanceOptimizer.getPerformanceStats();
    console.log('[SessionManager] Current memory usage:', stats.memoryStats.usedHeapSize, 'MB');

    // Optimize memory if usage is high
    if (stats.memoryStats.usedHeapSize > 200) { // 200MB threshold
      console.log('[SessionManager] Memory usage high, optimizing...');
      await performanceOptimizer.optimizeMemory({
        clearCaches: false, // Keep session cache
        compactChatHistory: true
      });
    }

    // Cleanup expired sessions
    await this.cleanupExpiredSessions();

    console.log('[SessionManager] Performance optimization complete');
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return performanceOptimizer.getPerformanceStats();
  }
}