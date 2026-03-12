// =====================================================
// Performance Module Index
// =====================================================

// Core performance modules
export { LazyLoader, LazyModule, LazyLoaderOptions, lazyLoader } from './lazyLoader';
export { Cache, CacheEntry, CacheOptions, CacheStats, sessionCache, chatCache, workspaceCache } from './cache';
export {
  PerformanceOptimizer,
  PerformanceConfig,
  MemoryStats,
  PerformanceStats,
  MemoryOptimizationOptions,
  performanceOptimizer
} from './performanceOptimizer';
export {
  ChatMemoryOptimizer,
  ChatMessage,
  ChatSession,
  ChatCompactionOptions,
  ChatMemoryStats,
  chatMemoryOptimizer
} from './chatMemoryOptimizer';

// Re-export types for convenience
export type {
  LazyModule as ILazyModule,
  LazyLoaderOptions as ILazyLoaderOptions
} from './lazyLoader';

export type {
  CacheEntry as ICacheEntry,
  CacheOptions as ICacheOptions,
  CacheStats as ICacheStats
} from './cache';

export type {
  PerformanceConfig as IPerformanceConfig,
  MemoryStats as IMemoryStats,
  PerformanceStats as IPerformanceStats,
  MemoryOptimizationOptions as IMemoryOptimizationOptions
} from './performanceOptimizer';

export type {
  ChatMessage as IChatMessage,
  ChatSession as IChatSession,
  ChatCompactionOptions as IChatCompactionOptions,
  ChatMemoryStats as IChatMemoryStats
} from './chatMemoryOptimizer';