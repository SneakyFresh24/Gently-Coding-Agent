// =====================================================
// Storage Types - Type definitions for session storage
// =====================================================

import { Session } from '../../types/SessionTypes';

/**
 * Storage configuration
 */
export interface StorageConfig {
  storagePath: string;
  maxSessions: number;
  sessionTimeout: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
}

/**
 * Serialized session data
 */
export interface SerializedSession {
  id: string;
  type: string;
  data: string;
  compressed: boolean;
  encrypted: boolean;
  checksum: string;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  totalSessions: number;
  totalSize: number;
  oldestSession: number;
  newestSession: number;
  sessionsByType: Record<string, number>;
}

/**
 * Storage event types
 */
export enum StorageEventType {
  SESSION_SAVED = 'sessionSaved',
  SESSION_LOADED = 'sessionLoaded',
  SESSION_DELETED = 'sessionDeleted',
  SESSIONS_CLEARED = 'sessionsCleared',
  STORAGE_COMPACTED = 'storageCompacted',
  ERROR_OCCURRED = 'errorOccurred'
}

/**
 * Storage event
 */
export interface StorageEvent {
  type: StorageEventType;
  sessionId?: string;
  timestamp: number;
  data?: any;
  error?: Error;
}

/**
 * Storage event listener
 */
export type StorageEventListener = (event: StorageEvent) => void;

/**
 * Session storage interface
 */
export interface ISessionStorage {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  getAllSessions(): Promise<Session[]>;
  getSessionsByType(type: string): Promise<Session[]>;
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  clearAllSessions(): Promise<void>;
  compact(): Promise<void>;
  getStats(): Promise<StorageStats>;
  addEventListener(type: StorageEventType, listener: StorageEventListener): void;
  removeEventListener(type: StorageEventType, listener: StorageEventListener): void;
  dispose(): void;
}