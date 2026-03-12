// No direct vscode import at top to keep tests running in standard node
/**
 * Persistence interfaces (subset of vscode.Memento)
 */
export interface Memento {
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: any): Thenable<void>;
}

export interface Disposable {
  dispose(): any;
}

/**
 * DLL Node for LRU tracking
 */
interface DLLNode<K> {
  key: K;
  prev: DLLNode<K> | null;
  next: DLLNode<K> | null;
}

/**
 * Cache entry with metadata and size tracking
 */
export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  size: number;
  node: DLLNode<string>;
}

/**
 * Cache options including persistence and limits
 */
export interface CacheOptions {
  /** Default TTL in milliseconds */
  defaultTtl?: number;
  /** Maximum number of entries */
  maxSize?: number;
  /** Maximum byte size (rough estimate) */
  maxByteSize?: number;
  /** Whether to enable statistics */
  enableStats?: boolean;
  /** Storage for persistence (vscode.Memento) */
  storage?: Memento;
  /** Prefix for persistent keys */
  storageKey?: string;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  size: number;
  byteSize: number;
  maxSize: number;
}

/**
 * Generic high-performance cache with O(1) LRU (DLL) and persistence
 */
export class Cache<T> implements Disposable {
  private entries = new Map<string, CacheEntry<T>>();
  private currentByteSize = 0;
  private head: DLLNode<string> | null = null;
  private tail: DLLNode<string> | null = null;
  private disposables: Disposable[] = [];

  // Statistics
  private hits = 0;
  private misses = 0;

  private static ttlScale = 1.0;

  constructor(private options: CacheOptions = {}) {
    this.options.defaultTtl = this.options.defaultTtl || 300000;
    this.options.maxSize = this.options.maxSize || 1000;
    this.options.maxByteSize = this.options.maxByteSize || 50 * 1024 * 1024; // 50MB default
    this.options.enableStats = this.options.enableStats !== false;

    // Load from persistence if storage is provided
    this.loadFromStorage();

    // Setup cleanup interval
    const cleanupInterval = setInterval(() => this.cleanup(), 60000);
    this.disposables.push({ dispose: () => clearInterval(cleanupInterval) });
  }

  /**
   * Set global TTL scale (e.g. 0.5 to halve all TTLs under memory pressure)
   */
  public static setGlobalTtlScale(scale: number): void {
    this.ttlScale = Math.max(0.1, Math.min(1.0, scale));
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.entries.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (this.isExpired(entry)) {
      this.delete(key);
      this.misses++;
      return null;
    }

    // Move to front (LRU)
    this.moveToFront(entry.node);
    this.hits++;

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T, ttl?: number): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.delete(key);
    }

    const size = this.estimateSize(value);
    const node: DLLNode<string> = { key, prev: null, next: null };

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.options.defaultTtl!,
      size,
      node
    };

    this.entries.set(key, entry);
    this.currentByteSize += size;
    this.addToFront(node);

    this.evictIfFull();
    this.saveToStorage();
  }

  /**
   * Delete entry
   */
  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;

    this.removeNode(entry.node);
    this.currentByteSize -= entry.size;
    this.entries.delete(key);
    this.saveToStorage();
    return true;
  }

  private isExpired(entry: CacheEntry<T>): boolean {
    const scaledTtl = entry.ttl * Cache.ttlScale;
    return Date.now() - entry.timestamp > scaledTtl;
  }

  private estimateSize(value: any): number {
    try {
      if (typeof value === 'string') return value.length * 2;
      // Using Blob for better accuracy if available (Node.js 15+)
      if (typeof Blob !== 'undefined') {
        const str = JSON.stringify(value);
        return new Blob([str]).size;
      }
      return JSON.stringify(value).length * 2;
    } catch {
      return 1024; // Fallback
    }
  }

  /** DLL Operations O(1) */

  private addToFront(node: DLLNode<string>): void {
    node.next = this.head;
    node.prev = null;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
  }

  private removeNode(node: DLLNode<string>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
  }

  private moveToFront(node: DLLNode<string>): void {
    this.removeNode(node);
    this.addToFront(node);
  }

  private evictIfFull(): void {
    while (
      (this.entries.size > this.options.maxSize! ||
        this.currentByteSize > this.options.maxByteSize!) &&
      this.tail
    ) {
      this.delete(this.tail.key);
    }
  }

  /** Persistence */

  private loadFromStorage(): void {
    if (!this.options.storage || !this.options.storageKey) return;
    const data = this.options.storage.get<any>(this.options.storageKey);
    if (!data || typeof data !== 'object') return;

    for (const [key, val] of Object.entries(data)) {
      // Re-hydrate entry (simplified, without full metadata)
      this.set(key, (val as any).value, (val as any).ttl);
    }
  }

  private saveToStorage(): void {
    if (!this.options.storage || !this.options.storageKey) return;
    const data: Record<string, any> = {};
    // Only save critical small data to Memento (e.g. metadata, not huge buffers)
    for (const [key, entry] of this.entries) {
      if (entry.size < 50000) { // Safety limit for Memento
        data[key] = { value: entry.value, ttl: entry.ttl, timestamp: entry.timestamp };
      }
    }
    this.options.storage.update(this.options.storageKey, data);
  }

  /** Standard API */

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.currentByteSize = 0;
    this.head = null;
    this.tail = null;
    this.saveToStorage();
  }

  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = await factory();
    this.set(key, value, ttl);
    return value;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0,
      size: this.entries.size,
      byteSize: this.currentByteSize,
      maxSize: this.options.maxSize!
    };
  }

  /** Invalidation */

  private invalidationTimer: NodeJS.Timeout | null = null;

  /**
   * Invalidate cache based on an event (debounced)
   */
  invalidateOn(event: any, pattern?: RegExp | ((key: string) => boolean)): void {
    const handler = () => {
      if (this.invalidationTimer) clearTimeout(this.invalidationTimer);
      this.invalidationTimer = setTimeout(() => {
        if (!pattern) {
          this.clear();
        } else {
          for (const key of this.entries.keys()) {
            const shouldDelete = pattern instanceof RegExp ? pattern.test(key) : pattern(key);
            if (shouldDelete) this.delete(key);
          }
        }
      }, 500); // 500ms debounce
    };

    this.disposables.push(event(handler));
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.timestamp > entry.ttl) {
        this.delete(key);
      }
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

// Global cache instances (placeholders until setup)
export let sessionCache = new Cache<any>({ maxSize: 500 });
export let chatCache = new Cache<any>({ maxSize: 100 });
export let workspaceCache = new Cache<any>({ maxSize: 1000 });

/**
 * Setup caches with persistent storage
 */
export function setupGlobalCaches(context: { globalState: Memento; workspaceState: Memento }): void {
  // Replace placeholders with persistent versions
  sessionCache = new Cache<any>({
    maxSize: 500,
    storage: context.globalState,
    storageKey: 'session_cache_v1'
  });

  chatCache = new Cache<any>({
    maxSize: 100,
    storage: context.workspaceState,
    storageKey: 'chat_cache_v1'
  });

  workspaceCache = new Cache<any>({
    maxSize: 1000,
    storage: context.workspaceState,
    storageKey: 'workspace_cache_v1'
  });

  // Wire up document change invalidation for workspace cache (throttled)
  const vscode = (() => { try { return require('vscode'); } catch { return {}; } })();
  if (vscode.workspace?.onDidChangeTextDocument) workspaceCache.invalidateOn(vscode.workspace.onDidChangeTextDocument);
}