import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cache, setupGlobalCaches, sessionCache, chatCache, workspaceCache } from './cache';

describe('Cache', () => {
  let cache: Cache<string>;
  let mockMemento: any;

  beforeEach(() => {
    mockMemento = {
      get: vi.fn(),
      update: vi.fn().mockResolvedValue(undefined)
    };

    cache = new Cache<string>({
      defaultTtl: 1000,
      maxSize: 5,
      maxByteSize: 1024, // 1KB
      enableStats: true
    });
  });

  afterEach(() => {
    cache.dispose();
  });

  describe('DLL Eviction', () => {
    it('should evict the least recently used item (O(1))', () => {
      // maxSize is 5
      for (let i = 0; i < 5; i++) {
        cache.set(`key${i}`, `val${i}`);
      }

      // Access key0 to make it MRU
      cache.get('key0');

      // Add key5, should evict key1 (the next LRU)
      cache.set('key5', 'val5');

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key0')).toBe('val0');
    });
  });

  describe('Persistence', () => {
    it('should load initial data from storage', () => {
      mockMemento.get.mockReturnValue({
        'persisted': { value: 'old-val', ttl: 1000, timestamp: Date.now() }
      });

      const pCache = new Cache<string>({
        storage: mockMemento,
        storageKey: 'test-cache'
      });

      expect(pCache.get('persisted')).toBe('old-val');
    });

    it('should save data to storage on set', () => {
      const pCache = new Cache<string>({
        storage: mockMemento,
        storageKey: 'test-cache'
      });

      pCache.set('new-key', 'new-val');

      expect(mockMemento.update).toHaveBeenCalledWith('test-cache', expect.objectContaining({
        'new-key': expect.objectContaining({ value: 'new-val' })
      }));
    });
  });

  describe('Byte Size Enforcement', () => {
    it('should evict entries when byte size limit is reached', () => {
      const smallCache = new Cache<string>({
        maxByteSize: 100 // VERY small
      });

      // "val" is ~6 bytes (UTF-16 estimate) or ~5 bytes (Blob estimate)
      // Let's set a large value
      const largeVal = "a".repeat(80); // ~160 bytes
      smallCache.set('large', largeVal);

      smallCache.set('another', "short");

      // Adding 'another' might trigger eviction if 'large' is too big
      // If large is 160 and limit is 100, it should evict large immediately
      expect(smallCache.get('large')).toBeNull();
    });
  });

  describe('Invalidation', () => {
    it('should invalidate cache on event (debounced)', async () => {
      let trigger: any;
      const event = (h: any) => { trigger = h; return { dispose: () => { } }; };

      cache.set('key1', 'val1');
      cache.invalidateOn(event);

      trigger();

      // Should still be there (debounced)
      expect(cache.get('key1')).toBe('val1');

      // Wait for debounce (500ms)
      await new Promise(resolve => setTimeout(resolve, 600));

      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('Standard Cache Logic', () => {
    it('should return null for expired entry', async () => {
      cache.set('key', 'value', 100);
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get('key')).toBeNull();
    });

    it('should update stats correctly', () => {
      cache.set('key', 'val');
      cache.get('key');
      cache.get('miss');

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });
  });
});

describe('Global Cache Setup', () => {
  it('should initialize global caches with storage', () => {
    const context = {
      globalState: { get: vi.fn(), update: vi.fn() } as any,
      workspaceState: { get: vi.fn(), update: vi.fn() } as any
    };

    setupGlobalCaches(context);

    expect(sessionCache).toBeDefined();
    expect(chatCache).toBeDefined();
    expect(workspaceCache).toBeDefined();
  });

  it('should persist data after re-initialization (integration)', () => {
    const storage: any = {
      data: {} as Record<string, any>,
      get(key: string) { return this.data[key]; },
      update(key: string, val: any) { this.data[key] = val; }
    };

    const context = { globalState: storage, workspaceState: storage };

    // 1. Initial setup
    setupGlobalCaches(context);
    chatCache.set('persist-test', 'hero-content');

    // 2. Simulate "reload" by calling setup again
    setupGlobalCaches(context);

    // 3. Verify value survives
    expect(chatCache.get('persist-test')).toBe('hero-content');
  });
});
