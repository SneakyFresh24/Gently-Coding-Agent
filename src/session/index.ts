// =====================================================
// Session Modules Index - Central export for all session modules
// =====================================================

// Main session manager
export { SessionManager } from './SessionManager';

// Session types
export type { 
  Session, 
  SessionType, 
  SessionStatus,
  ChatSession,
  ChatMessage,
  WorkspaceSession,
  SessionProvider,
  SessionStorage,
  SessionManager as ISessionManager
} from './types/SessionTypes';

// Storage modules
export { SessionStorageImpl } from './storage/SessionStorage';
export type { 
  ISessionStorage,
  StorageConfig,
  SerializedSession,
  StorageStats,
  StorageEvent,
  StorageEventType,
  StorageEventListener
} from './storage/types/StorageTypes';

// Provider modules
export { ChatSessionProvider } from './providers/ChatSessionProvider';
export { AuthSessionProvider } from './providers/AuthSessionProvider';
export { WorkspaceSessionProvider } from './providers/WorkspaceSessionProvider';