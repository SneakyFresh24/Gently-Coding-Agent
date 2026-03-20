import { Level } from 'level';
import { LRUCache } from 'lru-cache';
import { XXHash64 } from 'xxhash-addon';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface CacheOptions {
    persistenceDir: string;
    maxMemoryEntries?: number;
    ttlDays?: number;
}

export class EmbeddingCache {
    private db: Level<string, string> | null = null;
    private memoryCache: LRUCache<string, number[]>;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private readonly ttlMs: number;
    private nativeHasherClass: any = null;
    private hasNativeHasher: boolean = false;

    constructor(options: CacheOptions) {
        this.ttlMs = (options.ttlDays || 30) * 24 * 60 * 60 * 1000;

        this.memoryCache = new LRUCache<string, number[]>({
            max: options.maxMemoryEntries || 2000,
            ttl: this.ttlMs,
            updateAgeOnGet: true
        });

        // Try load native hasher
        try {
            const mod = require('xxhash-addon');
            this.nativeHasherClass = mod.XXHash64;
            this.hasNativeHasher = true;
            console.log('[EmbeddingCache] Native XXHash64 loaded ✓');
        } catch (e) {
            console.warn('[EmbeddingCache] Native XXHash64 NOT found. Falling back to simple hash.');
        }

        this.initPromise = this.initialize(options.persistenceDir);
    }

    private async initialize(persistenceDir: string): Promise<void> {
        const dbPath = path.join(persistenceDir, 'embeddings.db');
        const lockPath = path.join(dbPath, 'LOCK');
        const maxRetries = 3;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await fs.mkdir(persistenceDir, { recursive: true });
                
                // Try recovery if LOCK exists and it's not the first attempt
                if (attempt > 1 && await this.fileExists(lockPath)) {
                    try {
                        await fs.unlink(lockPath);
                        console.log(`[EmbeddingCache] (Attempt ${attempt}) Stale LOCK file removed`);
                    } catch (e) {
                        // Ignore if already gone, otherwise log it
                    }
                }

                this.db = new Level<string, string>(dbPath);
                await this.db.open();
                this.initialized = true;
                console.log(`[EmbeddingCache] Initialized at ${dbPath} (Attempt ${attempt})`);
                return;
            } catch (error: any) {
                const isBusy = error.code === 'EBUSY' || error.code === 'EPERM' || error.message?.includes('locked');
                
                if (isBusy && attempt < maxRetries) {
                    console.warn(`[EmbeddingCache] DB is busy (Attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }

                if (attempt === maxRetries) {
                    console.error('[EmbeddingCache] All initialization attempts failed → falling back to memory-only mode', error);
                    this.db = null;
                    this.initialized = true;
                }
            }
        }
    }


    private async fileExists(p: string): Promise<boolean> {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Generates a fast hash key for the content
     */
    private generateKey(content: string, modelName: string): string {
        if (this.hasNativeHasher && this.nativeHasherClass) {
            try {
                // Create fresh instance per digest to avoid state corruption/reuse issues
                const hasher = new this.nativeHasherClass(Buffer.from('gentlyv1')); 
                hasher.update(Buffer.from(content));
                const hash = hasher.digest().toString('hex');
                return `${modelName}:${hash}`;
            } catch (e) {
                // Fallback on instance error
                this.hasNativeHasher = false;
            }
        }
        
        // Simple fallback hash (non-native)
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return `${modelName}:fb-${hash.toString(16)}`;
    }

    /**
     * Get embedding from cache
     */
    async get(content: string, modelName: string): Promise<number[] | null> {
        if (!this.initialized) await this.initPromise;

        const key = this.generateKey(content, modelName);

        // 1. Memory check
        const cached = this.memoryCache.get(key);
        if (cached) return cached;

        // 2. Disk check
        if (this.db) {
            try {
                const data = await this.db.get(key);
                const { embedding, timestamp } = JSON.parse(data);

                // Check TTL
                if (Date.now() - timestamp > this.ttlMs) {
                    await this.db.del(key);
                    return null;
                }

                this.memoryCache.set(key, embedding);
                return embedding;
            } catch (error: any) {
                if (error.code !== 'LEVEL_NOT_FOUND' && error.code !== 'LEVEL_NOT_OPEN') {
                    console.warn('[EmbeddingCache] Disk get error:', error.message);
                }
            }
        }

        return null;
    }

    /**
     * Set embedding in cache
     */
    async set(content: string, modelName: string, embedding: number[]): Promise<void> {
        if (!this.initialized) await this.initPromise;

        const key = this.generateKey(content, modelName);
        const data = JSON.stringify({
            embedding,
            timestamp: Date.now()
        });

        // 1. Memory set
        this.memoryCache.set(key, embedding);

        // 2. Disk set
        if (this.db) {
            try {
                // LevelDB 10+ might throw if closed
                await this.db.put(key, data);
            } catch (error: any) {
                if (error.code !== 'LEVEL_NOT_OPEN') {
                    console.warn('[EmbeddingCache] Disk put error:', error.message);
                }
            }
        }
    }

    /**
     * Batch set embeddings
     */
    async setBatch(items: Array<{ content: string; embedding: number[] }>, modelName: string): Promise<void> {
        if (!this.initialized) await this.initPromise;

        if (!this.db) {
            for (const item of items) {
                await this.set(item.content, modelName, item.embedding);
            }
            return;
        }

        const ops = items.map(item => {
            const key = this.generateKey(item.content, modelName);
            this.memoryCache.set(key, item.embedding);
            return {
                type: 'put' as const,
                key,
                value: JSON.stringify({
                    embedding: item.embedding,
                    timestamp: Date.now()
                })
            };
        });

        try {
            await this.db.batch(ops);
        } catch (error: any) {
            console.warn('[EmbeddingCache] Disk batch error:', error.message);
        }
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        if (!this.initialized) await this.initPromise;

        this.memoryCache.clear();
        if (this.db) {
            await this.db.clear();
        }
    }

    /**
     * Close the cache
     */
    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
        }
    }
}
