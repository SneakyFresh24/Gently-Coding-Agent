// =====================================================
// Session Manager Integration Tests with Performance Modules
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { SessionManager } from '../session/SessionManager';
import { SessionType } from '../session/types/SessionTypes';
import { sessionCache } from './cache';
import { performanceOptimizer } from './performanceOptimizer';

// Create a mock directory map to track directories
const mockDirectories = new Set<string>();

// Mock SessionStorageImpl
vi.mock('../session/storage/SessionStorage', () => ({
  SessionStorageImpl: vi.fn().mockImplementation(() => ({
    saveSession: vi.fn().mockImplementation(async (session) => {
      // Store session in mock storage
      mockSessionStorage.set(session.id, session);
      return session;
    }),
    loadSession: vi.fn().mockImplementation(async (sessionId) => {
      // Get session from mock storage
      return mockSessionStorage.get(sessionId) || null;
    }),
    getSession: vi.fn().mockImplementation(async (sessionId) => {
      // Get session from mock storage
      return mockSessionStorage.get(sessionId) || null;
    }),
    updateSession: vi.fn().mockImplementation(async (sessionId, updates) => {
      // Update session in mock storage
      const session = mockSessionStorage.get(sessionId);
      if (session) {
        Object.assign(session, updates);
        mockSessionStorage.set(sessionId, session);
        return session;
      }
      return null;
    }),
    deleteSession: vi.fn().mockImplementation(async (sessionId) => {
      // Delete session from mock storage
      const exists = mockSessionStorage.has(sessionId);
      if (exists) {
        mockSessionStorage.delete(sessionId);
        return true;
      }
      return false;
    }),
    getAllSessions: vi.fn().mockImplementation(async () => {
      // Get all sessions from mock storage
      return Array.from(mockSessionStorage.values());
    }),
    getSessionsByType: vi.fn().mockImplementation(async (type) => {
      // Get sessions by type from mock storage
      return Array.from(mockSessionStorage.values()).filter(s => s.type === type);
    }),
    getStats: vi.fn().mockImplementation(async () => {
      // Get storage statistics
      return {
        totalSessions: mockSessionStorage.size,
        totalSize: mockSessionStorage.size * 1024, // Mock size
        oldestSession: mockSessionStorage.size > 0 ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null,
        newestSession: mockSessionStorage.size > 0 ? new Date() : null
      };
    }),
    compact: vi.fn().mockImplementation(async () => {
      // Compact storage (no-op for mock)
      return;
    }),
    dispose: vi.fn()
  }))
}));

// Mock VS Code API
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [
      {
        uri: { fsPath: '/test/workspace' },
        name: 'test-workspace'
      }
    ]
  }
}));

// Create a mock storage for sessions
const mockSessionStorage = new Map<string, any>();

// Mock fs operations
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockImplementation((path: string) => {
    // Read from mock storage
    const sessionId = path.split('/').pop()?.replace('.json', '');
    if (!sessionId || !mockSessionStorage.has(sessionId)) {
      return Promise.reject(new Error('ENOENT: no such file or directory'));
    }
    return Promise.resolve(JSON.stringify(mockSessionStorage.get(sessionId)));
  }),
  writeFile: vi.fn().mockImplementation((path: string, data: string) => {
    // Write to mock storage
    const sessionId = path.split('/').pop()?.replace('.json', '');
    if (sessionId) {
      mockSessionStorage.set(sessionId, JSON.parse(data));
    }
    return Promise.resolve();
  }),
  unlink: vi.fn().mockImplementation((path: string) => {
    // Delete from mock storage
    const sessionId = path.split('/').pop()?.replace('.json', '');
    if (sessionId) {
      mockSessionStorage.delete(sessionId);
    }
    return Promise.resolve();
  }),
  readdir: vi.fn().mockImplementation(() => {
    // Return all session files
    return Promise.resolve(
      Array.from(mockSessionStorage.keys()).map(id => `${id}.json`)
    );
  }),
  access: vi.fn().mockImplementation((path: string) => {
    // Check if directory exists in our mock
    if (mockDirectories.has(path)) {
      return Promise.resolve();
    }
    
    // Check if file exists in mock storage
    const sessionId = path.split('/').pop()?.replace('.json', '');
    return sessionId && mockSessionStorage.has(sessionId)
      ? Promise.resolve()
      : Promise.reject(new Error('ENOENT: no such file or directory'));
  }),
  mkdir: vi.fn().mockImplementation((path: string, options?: any) => {
    // Track directories that have been created
    mockDirectories.add(path);
    return Promise.resolve(undefined);
  }),
  stat: vi.fn().mockResolvedValue({
    isDirectory: () => true,
    isFile: () => false,
    size: 1024,
    mtime: new Date()
  })
}));

// Mock path
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  basename: (path: string) => path.split('/').pop() || '',
  dirname: (path: string) => path.split('/').slice(0, -1).join('/') || '.'
}));

// Mock crypto
vi.mock('crypto', () => ({
  createHash: (algorithm: string) => ({
    update: (data: string) => ({
      digest: (encoding: string) => 'mock-checksum'
    })
  })
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-' + Math.random().toString(36).substring(2, 15))
}));

describe('SessionManager Integration with Performance Modules', () => {
  let sessionManager: SessionManager;
  let mockContext: any;

  beforeEach(() => {
    mockContext = {
      globalStorageUri: {
        fsPath: '/test/storage'
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      }
    };

    sessionManager = new SessionManager(mockContext);
  });

  afterEach(() => {
    sessionManager.dispose();
    vi.clearAllMocks();
    sessionCache.clear();
    mockSessionStorage.clear();
  });

  describe('Session Caching', () => {
    it('should cache sessions after retrieval', async () => {
      // Create a session
      const session = await sessionManager.createSession(SessionType.CHAT, {
        name: 'Test Chat Session',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      });

      // Get session (should cache it)
      const retrievedSession1 = await sessionManager.getSession(session.id);
      expect(retrievedSession1).toBeDefined();
      expect(retrievedSession1?.id).toBe(session.id);

      // Get session again (should use cache)
      const retrievedSession2 = await sessionManager.getSession(session.id);
      expect(retrievedSession2).toBeDefined();
      expect(retrievedSession2?.id).toBe(session.id);

      // Verify cache was used
      const cacheKey = `session:${session.id}`;
      const cachedSession = sessionCache.get(cacheKey);
      expect(cachedSession).toBeDefined();
      expect(cachedSession?.id).toBe(session.id);
    });

    it('should invalidate cache when session is updated', async () => {
      // Create a session
      const session = await sessionManager.createSession(SessionType.CHAT, {
        name: 'Test Chat Session',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      });

      // Get session (should cache it)
      await sessionManager.getSession(session.id);

      // Update session
      await sessionManager.updateSession(session.id, {
        name: 'Updated Chat Session'
      });

      // Verify cache was invalidated
      const cacheKey = `session:${session.id}`;
      const cachedSession = sessionCache.get(cacheKey);
      expect(cachedSession).toBeNull();

      // Get updated session
      const updatedSession = await sessionManager.getSession(session.id);
      expect(updatedSession?.name).toBe('Updated Chat Session');
    });

    it('should cache session lists', async () => {
      // Create multiple sessions
      await sessionManager.createSession(SessionType.CHAT, {
        name: 'Test Chat Session 1',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      });

      await sessionManager.createSession(SessionType.CHAT, {
        name: 'Test Chat Session 2',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      });

      // Get all sessions (should cache them)
      const allSessions1 = await sessionManager.getAllSessions();
      expect(allSessions1).toHaveLength(2);

      // Get all sessions again (should use cache)
      const allSessions2 = await sessionManager.getAllSessions();
      expect(allSessions2).toHaveLength(2);

      // Verify cache was used
      const cachedSessions = sessionCache.get('sessions:all');
      expect(cachedSessions).toBeDefined();
      expect(cachedSessions).toHaveLength(2);
    });
  });

  describe('Performance Optimization', () => {
    it('should get performance statistics', () => {
      const stats = sessionManager.getPerformanceStats();
      
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('cacheStats');
      expect(stats).toHaveProperty('memoryStats');
      expect(stats).toHaveProperty('lazyLoaderStats');
    });

    it('should optimize performance when requested', async () => {
      // Mock performance optimizer methods
      const optimizeMemorySpy = vi.spyOn(performanceOptimizer, 'optimizeMemory');
      const getPerformanceStatsSpy = vi.spyOn(performanceOptimizer, 'getPerformanceStats');

      // Set up mock stats with high memory usage
      getPerformanceStatsSpy.mockReturnValue({
        cacheStats: {
          session: { hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 100 },
          chat: { hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 100 },
          workspace: { hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 100 }
        },
        memoryStats: {
          usedHeapSize: 250, // High memory usage
          totalHeapSize: 500,
          externalMemory: 20,
          rssMemory: 300
        },
        lazyLoaderStats: {
          totalModules: 0,
          loadedModules: 0,
          loadingModules: 0
        }
      });

      // Optimize performance
      await sessionManager.optimizePerformance();

      // Should have called optimizeMemory due to high memory usage
      expect(optimizeMemorySpy).toHaveBeenCalledWith({
        clearCaches: false,
        compactChatHistory: true
      });
    });
  });

  describe('Cache Integration', () => {
    it('should use cache for frequently accessed sessions', async () => {
      // Create a session
      const session = await sessionManager.createSession(SessionType.CHAT, {
        name: 'Test Chat Session',
        model: 'gpt-3.5-turbo',
        temperature: 0.7
      });

      // Access session multiple times
      for (let i = 0; i < 5; i++) {
        const retrievedSession = await sessionManager.getSession(session.id);
        expect(retrievedSession?.id).toBe(session.id);
      }

      // Check cache statistics
      const cacheStats = sessionCache.getStats();
      expect(cacheStats.hits).toBeGreaterThan(0);
      expect(cacheStats.hitRate).toBeGreaterThan(0);
    });

    it('should handle cache misses gracefully', async () => {
      // Try to get a non-existent session
      const nonExistentSession = await sessionManager.getSession('non-existent-id');
      expect(nonExistentSession).toBeNull();

      // Check cache statistics
      const cacheStats = sessionCache.getStats();
      expect(cacheStats.misses).toBeGreaterThan(0);
    });
  });
});