// =====================================================
// Workspace Session Provider - Workspace session management
// =====================================================

import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { 
  WorkspaceSession, 
  SessionProvider, 
  SessionType, 
  SessionStatus 
} from '../types/SessionTypes';
import { ISessionStorage } from '../storage/types/StorageTypes';

/**
 * Workspace session provider implementation
 */
export class WorkspaceSessionProvider implements SessionProvider<WorkspaceSession> {
  constructor(private storage: ISessionStorage) {}

  /**
   * Create a new workspace session
   */
  async createSession(data: {
    workspacePath: string;
    workspaceName?: string;
  }): Promise<WorkspaceSession> {
    const now = Date.now();
    const workspaceName = data.workspaceName || path.basename(data.workspacePath);
    
    const session: WorkspaceSession = {
      id: uuidv4(),
      type: SessionType.WORKSPACE,
      name: `Workspace: ${workspaceName}`,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      status: SessionStatus.ACTIVE,
      metadata: {},
      workspacePath: data.workspacePath,
      workspaceName,
      indexedFiles: [],
      lastIndexedAt: 0
    };

    await this.storage.saveSession(session);
    console.log(`[WorkspaceSessionProvider] Created workspace session: ${session.id}`);
    return session;
  }

  /**
   * Get a workspace session by ID
   */
  async getSession(sessionId: string): Promise<WorkspaceSession | null> {
    const session = await this.storage.loadSession(sessionId);
    if (!session || session.type !== SessionType.WORKSPACE) {
      return null;
    }
    return session as WorkspaceSession;
  }

  /**
   * Update a workspace session
   */
  async updateSession(sessionId: string, updates: Partial<WorkspaceSession>): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    // Apply updates
    Object.assign(session, updates);
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    console.log(`[WorkspaceSessionProvider] Updated workspace session: ${sessionId}`);
  }

  /**
   * Delete a workspace session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    await this.storage.deleteSession(sessionId);
    console.log(`[WorkspaceSessionProvider] Deleted workspace session: ${sessionId}`);
  }

  /**
   * Get all workspace sessions
   */
  async getAllSessions(): Promise<WorkspaceSession[]> {
    const sessions = await this.storage.getSessionsByType(SessionType.WORKSPACE);
    return sessions as WorkspaceSession[];
  }

  /**
   * Validate a workspace session
   */
  validateSession(session: WorkspaceSession): boolean {
    // Check required fields
    if (!session.id || !session.type || session.type !== SessionType.WORKSPACE) {
      return false;
    }

    // Check workspace-specific fields
    if (!session.workspacePath || !session.workspaceName) {
      return false;
    }

    // Check indexed files array
    if (!Array.isArray(session.indexedFiles)) {
      return false;
    }

    return true;
  }

  /**
   * Export a workspace session
   */
  exportSession(session: WorkspaceSession): string {
    const exportData = {
      version: '1.0',
      exportedAt: Date.now(),
      session: {
        id: session.id,
        name: session.name,
        workspacePath: session.workspacePath,
        workspaceName: session.workspaceName,
        indexedFiles: session.indexedFiles,
        lastIndexedAt: session.lastIndexedAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
      }
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import a workspace session
   */
  importSession(data: string): WorkspaceSession {
    try {
      const importData = JSON.parse(data);
      
      if (!importData.version || !importData.session) {
        throw new Error('Invalid export format');
      }

      const sessionData = importData.session;
      const now = Date.now();
      
      const session: WorkspaceSession = {
        id: uuidv4(), // Generate new ID to avoid conflicts
        type: SessionType.WORKSPACE,
        name: `Imported Workspace: ${sessionData.workspaceName}`,
        createdAt: sessionData.createdAt || now,
        updatedAt: now,
        lastAccessedAt: now,
        status: SessionStatus.ACTIVE,
        metadata: {
          importedAt: now,
          originalId: sessionData.id
        },
        workspacePath: sessionData.workspacePath,
        workspaceName: sessionData.workspaceName,
        indexedFiles: sessionData.indexedFiles || [],
        lastIndexedAt: sessionData.lastIndexedAt || 0
      };

      // Validate imported session
      if (!this.validateSession(session)) {
        throw new Error('Invalid session data');
      }

      return session;
    } catch (error) {
      console.error('[WorkspaceSessionProvider] Error importing session:', error);
      throw new Error(`Failed to import session: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get workspace session by path
   */
  async getSessionByPath(workspacePath: string): Promise<WorkspaceSession | null> {
    const allSessions = await this.getAllSessions();
    
    // Find session with matching workspace path
    for (const session of allSessions) {
      if (session.workspacePath === workspacePath && session.status === SessionStatus.ACTIVE) {
        return session;
      }
    }
    
    return null;
  }

  /**
   * Update indexed files for a workspace session
   */
  async updateIndexedFiles(sessionId: string, indexedFiles: string[]): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    session.indexedFiles = indexedFiles;
    session.lastIndexedAt = Date.now();
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    console.log(`[WorkspaceSessionProvider] Updated indexed files for session: ${sessionId}`);
  }

  /**
   * Add indexed file to a workspace session
   */
  async addIndexedFile(sessionId: string, filePath: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    if (!session.indexedFiles.includes(filePath)) {
      session.indexedFiles.push(filePath);
      session.updatedAt = Date.now();
      session.lastAccessedAt = Date.now();

      await this.storage.saveSession(session);
      console.log(`[WorkspaceSessionProvider] Added indexed file to session: ${sessionId}`);
    }
  }

  /**
   * Remove indexed file from a workspace session
   */
  async removeIndexedFile(sessionId: string, filePath: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    const index = session.indexedFiles.indexOf(filePath);
    if (index !== -1) {
      session.indexedFiles.splice(index, 1);
      session.updatedAt = Date.now();
      session.lastAccessedAt = Date.now();

      await this.storage.saveSession(session);
      console.log(`[WorkspaceSessionProvider] Removed indexed file from session: ${sessionId}`);
    }
  }

  /**
   * Get workspace statistics
   */
  async getWorkspaceStats(sessionId: string): Promise<{
    fileCount: number;
    lastIndexedAt: number;
    workspaceSize: number; // Rough estimate
  }> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    return {
      fileCount: session.indexedFiles.length,
      lastIndexedAt: session.lastIndexedAt,
      workspaceSize: session.indexedFiles.length * 1024 // Rough estimate: 1KB per file
    };
  }

  /**
   * Reindex workspace session
   */
  async reindexWorkspace(sessionId: string, newIndexedFiles: string[]): Promise<void> {
    await this.updateIndexedFiles(sessionId, newIndexedFiles);
    console.log(`[WorkspaceSessionProvider] Reindexed workspace: ${sessionId}`);
  }

  /**
   * Archive workspace session
   */
  async archiveSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Workspace session not found: ${sessionId}`);
    }

    session.status = SessionStatus.ARCHIVED;
    session.updatedAt = Date.now();
    session.lastAccessedAt = Date.now();

    await this.storage.saveSession(session);
    console.log(`[WorkspaceSessionProvider] Archived workspace session: ${sessionId}`);
  }

  /**
   * Get session info without sensitive data
   */
  async getSessionInfo(sessionId: string): Promise<{
    id: string;
    name: string;
    workspacePath: string;
    workspaceName: string;
    fileCount: number;
    lastIndexedAt: number;
    status: SessionStatus;
    createdAt: number;
    lastAccessedAt: number;
  } | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      name: session.name,
      workspacePath: session.workspacePath,
      workspaceName: session.workspaceName,
      fileCount: session.indexedFiles.length,
      lastIndexedAt: session.lastIndexedAt,
      status: session.status,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt
    };
  }
}