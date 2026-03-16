// =====================================================
// Session Storage - Session persistence implementation
// =====================================================

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Session } from '../types/SessionTypes';
import {
  ISessionStorage,
  StorageConfig,
  SerializedSession,
  StorageStats,
  StorageEvent,
  StorageEventType,
  StorageEventListener
} from './types/StorageTypes';
import { Mutex } from '../../core/state/Mutex';
import { debounce, DebouncedFunction } from '../../utils/debounce';

/**
 * Session storage implementation
 */
export class SessionStorageImpl implements ISessionStorage {
  private config: StorageConfig;
  private eventListeners: Map<StorageEventType, StorageEventListener[]> = new Map();
  private disposed: boolean = false;
  private locks: Map<string, Mutex> = new Map();
  private debouncedSaves: Map<string, DebouncedFunction<(session: Session) => Promise<void>>> = new Map();

  constructor(config: StorageConfig) {
    this.config = config;
    this.initializeEventListeners();
  }

  private getLock(sessionId: string): Mutex {
    if (!this.locks.has(sessionId)) {
      this.locks.set(sessionId, new Mutex());
    }
    return this.locks.get(sessionId)!;
  }

  /**
   * Save session to storage (debounced)
   */
  async saveSession(session: Session): Promise<void> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    let debouncedSave = this.debouncedSaves.get(session.id);
    if (!debouncedSave) {
      debouncedSave = debounce(this.internalSaveSession.bind(this), 300);
      this.debouncedSaves.set(session.id, debouncedSave);
    }

    debouncedSave.trigger(session);
  }

  /**
   * Immediately save all pending sessions
   */
  async flush(): Promise<void> {
    console.log('[SessionStorage] Flushing all pending saves...');
    const flushPromises: Promise<any>[] = [];
    for (const debouncedSave of this.debouncedSaves.values()) {
      const result = debouncedSave.flush();
      if (result instanceof Promise) {
        flushPromises.push(result);
      }
    }
    await Promise.all(flushPromises);
  }

  /**
   * Internal save session to storage
   */
  private async internalSaveSession(session: Session): Promise<void> {
    const lock = this.getLock(session.id);
    return await lock.runExclusive(async () => {
      try {
        // Update session timestamps
        session.updatedAt = Date.now();
        session.lastAccessedAt = Date.now();

        // Save to file
        const filePath = this.getSessionFilePath(session.id);

        // Ensure directory exists before writing
        await this.ensureStorageDirectory();

        // Save session safely using atomic write
        const tempFilePath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        const backupFilePath = `${filePath}.bak`;

        // Create backup of current file if it exists
        try {
          await fs.access(filePath);
          await fs.copyFile(filePath, backupFilePath);
        } catch { /* ignore if no existing file */ }

        await fs.writeFile(tempFilePath, JSON.stringify(session, null, 2), 'utf8');
        await fs.rename(tempFilePath, filePath);

        // Emit event
        this.emitEvent({
          type: StorageEventType.SESSION_SAVED,
          sessionId: session.id,
          timestamp: Date.now()
        });

        console.log(`[SessionStorage] Saved session: ${session.id}`);
      } catch (error) {
        console.error(`[SessionStorage] Error saving session: ${session.id}`, error);
        this.emitEvent({
          type: StorageEventType.ERROR_OCCURRED,
          timestamp: Date.now(),
          error: error instanceof Error ? error : new Error('Unknown error')
        });
        throw error;
      }
    });
  }

  /**
   * Load session from storage
   */
  async loadSession(sessionId: string): Promise<Session | null> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      const filePath = this.getSessionFilePath(sessionId);

      // Check if file exists
      try {
        await fs.access(filePath);
      } catch {
        return null;
      }

      // Read file
      const data = await fs.readFile(filePath, 'utf8');

      let session: Session;
      try {
        session = JSON.parse(data);
      } catch (parseError) {
        console.error(`[SessionStorage] Corrupted session file: ${sessionId}`, parseError);

        // Attempt recovery from backup
        const recoveredFromBak = await this.recoverFromBackup(sessionId);
        if (recoveredFromBak) {
          session = recoveredFromBak;
        } else {
          // Attempt truncation recovery
          const recovered = this.attemptSessionRecovery(data);
          if (recovered) {
            console.log(`[SessionStorage] Recovered corrupted session via truncation: ${sessionId}`);
            session = recovered;
            // Overwrite with recovered data
            await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
          } else {
            // Recovery failed — delete the corrupted file
            console.error(`[SessionStorage] Recovery failed, deleting corrupted session: ${sessionId}`);
            try { await fs.unlink(filePath); } catch { /* ignore */ }
            return null;
          }
        }
      }

      // Update last accessed time
      session.lastAccessedAt = Date.now();

      // Emit event
      this.emitEvent({
        type: StorageEventType.SESSION_LOADED,
        sessionId: session.id,
        timestamp: Date.now()
      });

      console.log(`[SessionStorage] Loaded session: ${sessionId}`);
      return session;
    } catch (error) {
      console.error(`[SessionStorage] Error loading session: ${sessionId}`, error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        sessionId,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      return null;
    }
  }

  /**
   * Attempt to recover a corrupted session by truncating at last valid JSON
   */
  private async recoverFromBackup(sessionId: string): Promise<Session | null> {
    const filePath = this.getSessionFilePath(sessionId);
    const backupPath = `${filePath}.bak`;

    try {
      await fs.access(backupPath);
      const data = await fs.readFile(backupPath, 'utf8');
      const session = JSON.parse(data);
      console.log(`[SessionStorage] Successfully recovered session ${sessionId} from backup.`);
      
      // Restore the backup as the main file
      await fs.writeFile(filePath, data, 'utf8');
      return session;
    } catch (error) {
      console.error(`[SessionStorage] Recovery from backup failed for ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Attempt to recover a corrupted session by truncating at last valid JSON
   */
  private attemptSessionRecovery(data: string): Session | null {
    try {
      const lastBrace = data.lastIndexOf('}');
      if (lastBrace > 0) {
        const truncated = data.substring(0, lastBrace + 1);
        return JSON.parse(truncated);
      }
    } catch { /* truncation didn't help */ }
    return null;
  }

  /**
   * Delete session from storage
   */
  async deleteSession(sessionId: string): Promise<void> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      const filePath = this.getSessionFilePath(sessionId);

      // Delete file
      await fs.unlink(filePath);

      // Emit event
      this.emitEvent({
        type: StorageEventType.SESSION_DELETED,
        sessionId,
        timestamp: Date.now()
      });

      console.log(`[SessionStorage] Deleted session: ${sessionId}`);
    } catch (error) {
      console.error(`[SessionStorage] Error deleting session: ${sessionId}`, error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        sessionId,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      throw error;
    }
  }

  /**
   * Get all sessions from storage
   */
  async getAllSessions(): Promise<Session[]> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      console.log('[SessionStorage] Getting all sessions...');
      const sessionIds = await this.getSessionIds();
      console.log(`[SessionStorage] Found ${sessionIds.length} session IDs: ${sessionIds.join(', ')}`);
      const sessions: Session[] = [];

      for (const sessionId of sessionIds) {
        console.log(`[SessionStorage] Loading session: ${sessionId}`);
        const session = await this.loadSession(sessionId);
        if (session) {
          console.log(`[SessionStorage] Successfully loaded session: ${sessionId}, type: ${session.type}`);
          sessions.push(session);
        } else {
          console.log(`[SessionStorage] Failed to load session: ${sessionId}`);
        }
      }

      console.log(`[SessionStorage] Returning ${sessions.length} sessions total`);
      return sessions;
    } catch (error) {
      console.error('[SessionStorage] Error getting all sessions:', error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      return [];
    }
  }

  /**
   * Get sessions by type
   */
  async getSessionsByType(type: string): Promise<Session[]> {
    console.log(`[SessionStorage] Getting sessions of type: ${type}`);
    const allSessions = await this.getAllSessions();
    console.log(`[SessionStorage] Found ${allSessions.length} total sessions`);
    const filteredSessions = allSessions.filter(session => session.type === type);
    console.log(`[SessionStorage] Found ${filteredSessions.length} sessions of type: ${type}`);
    return filteredSessions;
  }

  /**
   * Update session in storage
   */
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    const session = await this.loadSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Apply updates
    Object.assign(session, updates);

    // Save updated session
    await this.saveSession(session);
  }

  /**
   * Clear all sessions from storage
   */
  async clearAllSessions(): Promise<void> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      const sessionIds = await this.getSessionIds();

      for (const sessionId of sessionIds) {
        await this.deleteSession(sessionId);
      }

      // Emit event
      this.emitEvent({
        type: StorageEventType.SESSIONS_CLEARED,
        timestamp: Date.now()
      });

      console.log('[SessionStorage] Cleared all sessions');
    } catch (error) {
      console.error('[SessionStorage] Error clearing all sessions:', error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      throw error;
    }
  }

  /**
   * Compact storage by removing expired sessions
   */
  async compact(): Promise<void> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      const allSessions = await this.getAllSessions();
      const now = Date.now();
      let compactedCount = 0;

      for (const session of allSessions) {
        // Check if session is expired
        if (now - session.lastAccessedAt > this.config.sessionTimeout) {
          await this.deleteSession(session.id);
          compactedCount++;
        }
      }

      // Emit event
      this.emitEvent({
        type: StorageEventType.STORAGE_COMPACTED,
        timestamp: Date.now(),
        data: { compactedCount }
      });

      console.log(`[SessionStorage] Compacted storage, removed ${compactedCount} expired sessions`);
    } catch (error) {
      console.error('[SessionStorage] Error compacting storage:', error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    if (this.disposed) {
      throw new Error('Storage has been disposed');
    }

    try {
      const allSessions = await this.getAllSessions();
      const sessionsByType: Record<string, number> = {};
      let totalSize = 0;
      let oldestSession = Date.now();
      let newestSession = 0;

      for (const session of allSessions) {
        // Count by type
        sessionsByType[session.type] = (sessionsByType[session.type] || 0) + 1;

        // Calculate size (rough estimate)
        totalSize += JSON.stringify(session).length;

        // Update timestamps
        oldestSession = Math.min(oldestSession, session.createdAt);
        newestSession = Math.max(newestSession, session.createdAt);
      }

      return {
        totalSessions: allSessions.length,
        totalSize,
        oldestSession,
        newestSession,
        sessionsByType
      };
    } catch (error) {
      console.error('[SessionStorage] Error getting stats:', error);
      this.emitEvent({
        type: StorageEventType.ERROR_OCCURRED,
        timestamp: Date.now(),
        error: error instanceof Error ? error : new Error('Unknown error')
      });
      throw error;
    }
  }

  /**
   * Add event listener
   */
  addEventListener(type: StorageEventType, listener: StorageEventListener): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    this.eventListeners.get(type)!.push(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(type: StorageEventType, listener: StorageEventListener): void {
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    console.log('[SessionStorage] Disposing...');
    this.disposed = true;
    this.eventListeners.clear();
  }

  /**
   * Initialize event listeners
   */
  private initializeEventListeners(): void {
    // Initialize empty arrays for all event types
    Object.values(StorageEventType).forEach(type => {
      this.eventListeners.set(type, []);
    });
  }

  /**
   * Emit event to listeners
   */
  private emitEvent(event: StorageEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(event);
        } catch (error) {
          console.error(`[SessionStorage] Error in event listener:`, error);
        }
      });
    }
  }

  /**
   * Get session file path
   */
  private getSessionFilePath(sessionId: string): string {
    return path.join(this.config.storagePath, `${sessionId}.json`);
  }

  /**
   * Get all session IDs
   */
  private async getSessionIds(): Promise<string[]> {
    try {
      console.log(`[SessionStorage] Getting session IDs from: ${this.config.storagePath}`);

      // Ensure directory exists first
      await this.ensureStorageDirectory();

      const files = await fs.readdir(this.config.storagePath);
      console.log(`[SessionStorage] Found files: ${files.join(', ')}`);
      const sessionFiles = files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
      console.log(`[SessionStorage] Session files: ${sessionFiles.join(', ')}`);
      return sessionFiles;
    } catch (error) {
      console.error(`[SessionStorage] Error getting session IDs:`, error);

      // If directory doesn't exist, try to create it and return empty array
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        console.log(`[SessionStorage] Directory doesn't exist, creating: ${this.config.storagePath}`);
        try {
          await fs.mkdir(this.config.storagePath, { recursive: true });
          console.log(`[SessionStorage] Successfully created directory: ${this.config.storagePath}`);
          return [];
        } catch (createError) {
          console.error(`[SessionStorage] Failed to create directory:`, createError);
          throw createError;
        }
      }

      // For other errors, throw them
      throw error;
    }
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureStorageDirectory(): Promise<void> {
    try {
      await fs.access(this.config.storagePath);
    } catch (error) {
      // If directory doesn't exist, create it
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        await fs.mkdir(this.config.storagePath, { recursive: true });
        console.log(`[SessionStorage] Created storage directory: ${this.config.storagePath}`);
      } else {
        throw error;
      }
    }

    // Clean up orphaned .tmp files from interrupted atomic writes
    try {
      const files = await fs.readdir(this.config.storagePath);
      for (const file of files) {
        if (file.endsWith('.tmp')) {
          await fs.unlink(path.join(this.config.storagePath, file));
          console.log(`[SessionStorage] Cleaned up orphaned temp file: ${file}`);
        }
      }
    } catch { /* ignore cleanup errors */ }
  }

  /**
   * Serialize session
   */
  private async serializeSession(session: Session): Promise<SerializedSession> {
    let data = JSON.stringify(session);
    let compressed = false;
    let encrypted = false;

    // Apply compression if enabled
    if (this.config.compressionEnabled) {
      // In a real implementation, you would use a compression library
      // For now, we'll just mark it as compressed
      compressed = true;
    }

    // Apply encryption if enabled
    if (this.config.encryptionEnabled) {
      // In a real implementation, you would use an encryption library
      // For now, we'll just mark it as encrypted
      encrypted = true;
    }

    // Calculate checksum
    const checksum = crypto.createHash('md5').update(data).digest('hex');

    return {
      id: session.id,
      type: session.type,
      data,
      compressed,
      encrypted,
      checksum
    };
  }

  /**
   * Deserialize session
   */
  private async deserializeSession(serializedSession: SerializedSession): Promise<Session> {
    let data = serializedSession.data;

    // Verify checksum
    const checksum = crypto.createHash('md5').update(data).digest('hex');
    if (checksum !== serializedSession.checksum) {
      throw new Error('Session data corruption detected');
    }

    // Apply decryption if needed
    if (serializedSession.encrypted) {
      // In a real implementation, you would use a decryption library
      // For now, we'll just mark it as decrypted
    }

    // Apply decompression if needed
    if (serializedSession.compressed) {
      // In a real implementation, you would use a decompression library
      // For now, we'll just mark it as decompressed
    }

    // Parse JSON
    const session: Session = JSON.parse(data);
    return session;
  }
}