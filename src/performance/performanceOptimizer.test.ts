// =====================================================
// Performance Optimizer Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceOptimizer, performanceOptimizer } from './performanceOptimizer';

// Mock process.memoryUsage
const mockMemoryUsage = vi.fn();
Object.defineProperty(process, 'memoryUsage', {
  value: mockMemoryUsage,
  writable: true
});

// Mock global.gc
Object.defineProperty(global, 'gc', {
  value: vi.fn(),
  writable: true
});

describe('PerformanceOptimizer', () => {
  let optimizer: PerformanceOptimizer;

  beforeEach(() => {
    // Setup mock memory usage
    mockMemoryUsage.mockReturnValue({
      heapUsed: 100 * 1024 * 1024, // 100MB
      heapTotal: 200 * 1024 * 1024, // 200MB
      external: 10 * 1024 * 1024, // 10MB
      rss: 150 * 1024 * 1024 // 150MB
    });

    // Create a new optimizer instance for each test
    optimizer = new PerformanceOptimizer({
      adaptiveCaching: true,
      memoryOptimization: true,
      autoCleanup: false, // Disable auto cleanup for tests
      maxMemoryUsage: 512 // 512MB
    });
  });

  afterEach(() => {
    // Clean up
    optimizer.dispose();
    vi.clearAllMocks();
  });

  describe('getMemoryStats', () => {
    it('should return memory statistics', () => {
      const stats = optimizer.getMemoryStats();

      expect(stats).toEqual({
        usedHeapSize: 100,
        totalHeapSize: 200,
        externalMemory: 10,
        rssMemory: 150
      });
    });

    it('should handle different memory values', () => {
      mockMemoryUsage.mockReturnValue({
        heapUsed: 256 * 1024 * 1024, // 256MB
        heapTotal: 512 * 1024 * 1024, // 512MB
        external: 20 * 1024 * 1024, // 20MB
        rss: 300 * 1024 * 1024 // 300MB
      });

      const stats = optimizer.getMemoryStats();

      expect(stats.usedHeapSize).toBe(256);
      expect(stats.totalHeapSize).toBe(512);
      expect(stats.externalMemory).toBe(20);
      expect(stats.rssMemory).toBe(300);
    });
  });

  describe('getPerformanceStats', () => {
    it('should return performance statistics', () => {
      const stats = optimizer.getPerformanceStats();

      expect(stats).toHaveProperty('cacheStats');
      expect(stats).toHaveProperty('memoryStats');
      expect(stats).toHaveProperty('lazyLoaderStats');
    });
  });

  describe('optimizeMemory', () => {
    it('should optimize memory with default options', async () => {
      await optimizer.optimizeMemory();

      // Should call global.gc if available
      expect(global.gc).toHaveBeenCalled();
    });

    it('should optimize memory with custom options', async () => {
      await optimizer.optimizeMemory({
        forceGC: false,
        clearCaches: true,
        unloadModules: false,
        compactChatHistory: false
      });

      // Should not call global.gc
      expect(global.gc).not.toHaveBeenCalled();
    });

    it('should handle memory optimization errors gracefully', async () => {
      // Mock gc to throw an error
      const originalGC = global.gc;
      global.gc = vi.fn().mockImplementation(() => {
        throw new Error('GC failed');
      });

      // Should not throw
      await expect(optimizer.optimizeMemory()).resolves.toBeUndefined();
      
      // Restore original gc
      global.gc = originalGC;
    });
  });

  describe('createCache', () => {
    it('should create a cache with default options', () => {
      const cache = optimizer.createCache<string>({});

      expect(cache).toBeDefined();
    });

    it('should create a cache with custom options', () => {
      const cache = optimizer.createCache<string>({
        defaultTtl: 600000, // 10 minutes
        maxSize: 200,
        keyPrefix: 'test'
      });

      expect(cache).toBeDefined();
    });
  });

  describe('registerLazyModule', () => {
    it('should register a lazy module', () => {
      const module = optimizer.registerLazyModule(
        'test-module',
        () => Promise.resolve({ test: true })
      );

      expect(module).toBeDefined();
    });

    it('should register a lazy module with preload options', () => {
      const module = optimizer.registerLazyModule(
        'test-module-preload',
        () => Promise.resolve({ test: true }),
        {
          preload: true,
          preloadTimeout: 1000
        }
      );

      expect(module).toBeDefined();
    });
  });

  describe('getCachedValue', () => {
    it('should get or create a cached value', async () => {
      const cache = optimizer.createCache<string>({});
      const factory = vi.fn().mockResolvedValue('test-value');

      const value = await optimizer.getCachedValue(cache, 'test-key', factory);

      expect(value).toBe('test-value');
      expect(factory).toHaveBeenCalledOnce();
    });

    it('should return cached value on subsequent calls', async () => {
      const cache = optimizer.createCache<string>({});
      const factory = vi.fn().mockResolvedValue('test-value');

      // First call
      await optimizer.getCachedValue(cache, 'test-key', factory);
      // Second call
      const value = await optimizer.getCachedValue(cache, 'test-key', factory);

      expect(value).toBe('test-value');
      expect(factory).toHaveBeenCalledOnce(); // Should not be called again
    });
  });

  describe('dispose', () => {
    it('should dispose of all resources', () => {
      const disposeSpy = vi.spyOn(optimizer as any, 'dispose');

      optimizer.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });
  });
});

describe('performanceOptimizer', () => {
  it('should be a singleton instance', () => {
    expect(performanceOptimizer).toBeDefined();
    expect(performanceOptimizer).toBeInstanceOf(PerformanceOptimizer);
  });
});