import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import { SessionStorageImpl } from './SessionStorage';
import { SessionType, SessionStatus } from '../types/SessionTypes';
import { StorageConfig } from './types/StorageTypes';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  copyFile: vi.fn(),
  rename: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomBytes: vi.fn().mockReturnValue({ toString: () => 'mock-random' }),
  createHash: vi.fn().mockImplementation(() => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('mock-checksum'),
  })),
}));

vi.mock('../../utils/debounce', () => ({
  debounce: vi.fn().mockImplementation((fn) => {
    let timeout: any;
    const debounced = {
      trigger: vi.fn().mockImplementation((...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), 300);
      }),
      flush: vi.fn().mockImplementation(async () => {
        clearTimeout(timeout);
        return fn();
      }),
      cancel: vi.fn().mockImplementation(() => {
        clearTimeout(timeout);
      })
    };
    return debounced;
  }),
}));

describe('SessionStorageImpl - Memory-First Consistency', () => {
  let storage: SessionStorageImpl;
  const config: StorageConfig = {
    storagePath: '/mock/storage',
    maxSessions: 10,
    sessionTimeout: 1000,
    compressionEnabled: false,
    encryptionEnabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    storage = new SessionStorageImpl(config);
  });

  it('should be able to load a session immediately after saving it (Memory-First)', async () => {
    const session: any = {
      id: 'test-session-id',
      type: SessionType.CHAT,
      name: 'Test Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessedAt: Date.now(),
      status: SessionStatus.ACTIVE,
      messages: [],
      metadata: {}
    };

    // Save session (triggers debounce)
    storage.saveSession(session);

    // File should NOT have been written yet (due to debounce)
    expect(fs.writeFile).not.toHaveBeenCalled();

    // But loadSession should return it immediately from memory
    const loadedSession = await storage.loadSession(session.id);
    expect(loadedSession).toBeDefined();
    expect(loadedSession?.id).toBe(session.id);
    expect(loadedSession?.name).toBe('Test Session');
    
    // Check if it really came from memory (fs operations not called)
    expect(fs.readFile).not.toHaveBeenCalled();
    expect(fs.access).not.toHaveBeenCalled();
  });

  it('should include pending sessions in getAllSessions', async () => {
    const session: any = {
        id: 'pending-id',
        type: SessionType.CHAT,
        name: 'Pending Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastAccessedAt: Date.now(),
        status: SessionStatus.ACTIVE,
        messages: [],
        metadata: {}
    };

    vi.mocked(fs.readdir).mockResolvedValue([] as any); // No files on disk
    vi.mocked(fs.access).mockResolvedValue(undefined);

    storage.saveSession(session);

    const allSessions = await storage.getAllSessions();
    expect(allSessions).toHaveLength(1);
    expect(allSessions[0].id).toBe(session.id);
  });

  it('should remove from memory map after successful disk save', async () => {
    const session: any = {
        id: 'flush-id',
        type: SessionType.CHAT,
        name: 'Flush Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastAccessedAt: Date.now(),
        status: SessionStatus.ACTIVE,
        messages: [],
        metadata: {}
    };

    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(session));

    storage.saveSession(session);
    
    // Advance timers so internalSaveSession runs
    await vi.runAllTimersAsync();
    
    expect(fs.writeFile).toHaveBeenCalled();

    // Now if we load it, it should hit the disk (since memory map was cleared)
    // We can verify this by checking if fs.readFile was called
    await storage.loadSession(session.id);
    expect(fs.readFile).toHaveBeenCalled();
  });

  it('should clear memory map on delete', async () => {
      const session: any = {
          id: 'delete-id',
          type: SessionType.CHAT,
          name: 'Delete Session',
          createdAt: Date.now()
      };

      storage.saveSession(session);
      expect(await storage.loadSession(session.id)).toBeDefined();

      await storage.deleteSession(session.id);
      
      // Should be gone from memory
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      expect(await storage.loadSession(session.id)).toBeNull();
  });
});
