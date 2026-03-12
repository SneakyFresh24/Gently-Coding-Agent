// =====================================================
// Session Types - Type definitions for session management
// =====================================================

/**
 * Session types
 */
export enum SessionType {
  CHAT = 'chat',
  WORKSPACE = 'workspace'
}

/**
 * Session status
 */
export enum SessionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ARCHIVED = 'archived',
  CORRUPTED = 'corrupted'
}

/**
 * Base session interface
 */
export interface Session {
  id: string;
  type: SessionType;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  status: SessionStatus;
  metadata: Record<string, any>;
}

/**
 * Command approval interface
 */
export interface CommandApproval {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: 'safe' | 'moderate' | 'risky';
  status: 'pending' | 'approved' | 'rejected';
}

/**
 * Tool execution interface
 */
export interface ToolExecution {
  toolName: string;
  isExecuting: boolean;
  startTime: number;
  endTime?: number;
  duration?: number;
  fileName?: string;
  diffStats?: { added: number; deleted: number };
}

/**
 * Checkpoint interface
 */
export interface Checkpoint {
  id: string;
  checkpointNumber: number;
  filesTracked: number;
}

/**
 * Chat message interface
 */
export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'command-approval' | 'tool-execution';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
  // Additional fields for specific message types
  fileReferences?: any[];
  toolCalls?: any[];
  checkpoint?: Checkpoint;
  isStreaming?: boolean;
  isSystemMessage?: boolean;
  commandApproval?: CommandApproval;
  toolExecution?: ToolExecution;
}

/**
 * Chat session interface
 */
export interface ChatSession extends Session {
  type: SessionType.CHAT;
  messages: ChatMessage[];
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Workspace session interface
 */
export interface WorkspaceSession extends Session {
  type: SessionType.WORKSPACE;
  workspacePath: string;
  workspaceName: string;
  indexedFiles: string[];
  lastIndexedAt: number;
}

/**
 * Session storage interface
 */
export interface SessionStorage {
  saveSession(session: Session): Promise<void>;
  loadSession(sessionId: string): Promise<Session | null>;
  deleteSession(sessionId: string): Promise<void>;
  getAllSessions(): Promise<Session[]>;
  getSessionsByType(type: SessionType): Promise<Session[]>;
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>;
  clearAllSessions(): Promise<void>;
}

/**
 * Session provider interface
 */
export interface SessionProvider<T extends Session = Session> {
  createSession(data: any): Promise<T>;
  getSession(sessionId: string): Promise<T | null>;
  updateSession(sessionId: string, updates: Partial<T>): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getAllSessions(): Promise<T[]>;
  validateSession(session: T): boolean;
  exportSession(session: T): string;
  importSession(data: string): T;
}

/**
 * Session manager interface
 */
export interface SessionManager {
  createSession(type: SessionType, data: any): Promise<Session>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, data: Partial<Session>): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getAllSessions(): Promise<Session[]>;
  getSessionsByType(type: SessionType): Promise<Session[]>;
  getActiveSession(type: SessionType): Promise<Session | null>;
  setActiveSession(type: SessionType, sessionId: string): Promise<void>;
  saveSessions(): Promise<void>;
  loadSessions(): Promise<void>;
  cleanupExpiredSessions(): Promise<void>;
  dispose(): void;
}