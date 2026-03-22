import { Level } from 'level';
import { LRUCache } from 'lru-cache';
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
    private readonly dbPath: string;
    private readonly ttlMs: number;
    private nativeHasherClass: any = null;
    private hasNativeHasher: boolean = false;
    private degradedMode: boolean = false;
    private degradedReason: string | null = null;
    private warnedDegradedState: boolean = false;

    constructor(options: CacheOptions) {
        this.ttlMs = (options.ttlDays || 30) * 24 * 60 * 60 * 1000;
        this.dbPath = path.join(options.persistenceDir, 'embeddings.db');

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
        const lockPath = path.join(this.dbPath, 'LOCK');
        const maxRetries = 3;
        const retryDelay = 1000;
        let lastError: unknown;
        let lastClassification: string = 'unknown';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await fs.mkdir(persistenceDir, { recursive: true });

                if (attempt > 1 && await this.fileExists(lockPath)) {
                    await this.tryRemoveStaleLock(lockPath, attempt);
                }

                this.db = new Level<string, string>(this.dbPath);
                await this.db.open();
                this.initialized = true;
                this.degradedMode = false;
                this.degradedReason = null;
                console.log(`[EmbeddingCache] LevelDB initialized at ${this.dbPath} (Attempt ${attempt})`);
                return;
            } catch (error: any) {
                lastError = error;
                this.db = null;
                const classification = this.classifyLevelDbError(error);
                lastClassification = classification;
                const retryable = this.isRetryableClassification(classification);

                if (retryable && attempt < maxRetries) {
                    console.warn(`[EmbeddingCache] LevelDB init retry (${attempt}/${maxRetries}) due to ${classification}. Retrying in ${retryDelay}ms...`);
                    await this.sleep(retryDelay);
                    continue;
                }
            }
        }

        this.enterDegradedMode(
            `LevelDB initialization failed (${lastClassification}).`,
            lastError
        );
    }


    private async fileExists(p: string): Promise<boolean> {
        try {
            await fs.access(p);
            return true;
        } catch {
            return false;
        }
    }

    private async tryRemoveStaleLock(lockPath: string, attempt: number): Promise<void> {
        try {
            await fs.unlink(lockPath);
            console.warn(`[EmbeddingCache] Removed stale LOCK file before retry (Attempt ${attempt})`);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.warn(`[EmbeddingCache] Could not remove LOCK file (${lockPath}): ${error?.message || String(error)}`);
            }
        }
    }

    private classifyLevelDbError(error: any): string {
        const code = String(error?.code || '').toUpperCase();
        const message = this.buildErrorText(error).toLowerCase();
        const inElectron = typeof process.versions.electron === 'string' && process.versions.electron.length > 0;

        if (code === 'EBUSY' || message.includes('lock') || message.includes('resource busy')) {
            return 'lock-busy';
        }
        if (code === 'EPERM' || code === 'EACCES' || message.includes('access is denied') || message.includes('permission')) {
            return 'permission';
        }
        if (
            message.includes('node_module_version') ||
            message.includes('module did not self-register') ||
            message.includes('was compiled against a different node.js version') ||
            message.includes('could not locate the bindings file') ||
            message.includes('invalid elf header') ||
            message.includes('database failed to open')
        ) {
            return 'native-binding';
        }
        if (inElectron && message.includes('failed to open')) {
            // In Electron runtime this error often wraps ABI/native binding mismatches.
            return 'native-binding';
        }
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return 'path';
        }
        return 'unknown';
    }

    private isRetryableClassification(classification: string): boolean {
        return classification === 'lock-busy';
    }

    private enterDegradedMode(reason: string, error?: unknown): void {
        this.db = null;
        this.degradedMode = true;
        this.degradedReason = reason;
        this.initialized = true;
        this.warnDegradedMode(error);
    }

    private warnDegradedMode(error?: unknown): void {
        if (this.warnedDegradedState) return;
        this.warnedDegradedState = true;
        const runtime = this.getRuntimeSummary();
        const electronVersion = process.versions.electron || 'unknown';
        const rebuildHint = electronVersion !== 'unknown'
            ? `npx electron-rebuild -v ${electronVersion} --arch x64 -w level -w xxhash-addon`
            : `npm run rebuild`;
        console.error(
            `[EmbeddingCache] MEMORY-ONLY degraded mode active. Reason: ${this.degradedReason}. ` +
            `Persistent LevelDB cache is unavailable. Runtime=${runtime}. ` +
            `Recommended recovery: run "npm rebuild level xxhash-addon" and "${rebuildHint}".`
        );
        if (error) {
            console.error('[EmbeddingCache] LevelDB failure details:', error);
            const errorText = this.buildErrorText(error);
            if (errorText.trim()) {
                console.error('[EmbeddingCache] LevelDB failure summary:', errorText.substring(0, 1200));
            }
        }
    }

    private async handleRuntimeDbError(operation: string, error: any): Promise<void> {
        const classification = this.classifyLevelDbError(error);
        if (classification === 'lock-busy' || classification === 'native-binding' || classification === 'permission' || classification === 'path') {
            this.enterDegradedMode(`LevelDB runtime failure during ${operation} (${classification}).`, error);
            return;
        }
        if (error?.code !== 'LEVEL_NOT_FOUND' && error?.code !== 'LEVEL_NOT_OPEN') {
            console.warn(`[EmbeddingCache] LevelDB ${operation} error:`, error?.message || String(error));
        }
    }

    private async sleep(ms: number): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    private getRuntimeSummary(): string {
        const node = process.versions.node || 'unknown';
        const electron = process.versions.electron || 'none';
        const modules = process.versions.modules || 'unknown';
        return `node=${node},electron=${electron},modules=${modules}`;
    }

    private buildErrorText(error: any): string {
        const parts: string[] = [];
        const walk = (value: any): void => {
            if (!value) return;
            const message = typeof value.message === 'string' ? value.message : '';
            const code = typeof value.code === 'string' ? value.code : '';
            const name = typeof value.name === 'string' ? value.name : '';
            const stack = typeof value.stack === 'string' ? value.stack : '';
            if (name) parts.push(name);
            if (code) parts.push(code);
            if (message) parts.push(message);
            if (stack) parts.push(stack);
            if (value.cause && value.cause !== value) {
                walk(value.cause);
            }
        };
        walk(error);
        if (parts.length === 0) {
            return String(error ?? '');
        }
        return parts.join(' | ');
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
        if (this.degradedMode) {
            this.warnDegradedMode();
        }

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
                await this.handleRuntimeDbError('get', error);
            }
        }

        return null;
    }

    /**
     * Set embedding in cache
     */
    async set(content: string, modelName: string, embedding: number[]): Promise<void> {
        if (!this.initialized) await this.initPromise;
        if (this.degradedMode) {
            this.warnDegradedMode();
        }

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
                await this.db.put(key, data);
            } catch (error: any) {
                await this.handleRuntimeDbError('put', error);
            }
        }
    }

    /**
     * Batch set embeddings
     */
    async setBatch(items: Array<{ content: string; embedding: number[] }>, modelName: string): Promise<void> {
        if (!this.initialized) await this.initPromise;
        if (this.degradedMode) {
            this.warnDegradedMode();
        }

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
            await this.handleRuntimeDbError('batch', error);
        }
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        if (!this.initialized) await this.initPromise;

        this.memoryCache.clear();
        if (this.db) {
            try {
                await this.db.clear();
            } catch (error: any) {
                await this.handleRuntimeDbError('clear', error);
            }
        }
    }

    /**
     * Close the cache
     */
    async close(): Promise<void> {
        if (this.db) {
            try {
                await this.db.close();
            } catch (error: any) {
                await this.handleRuntimeDbError('close', error);
            } finally {
                this.db = null;
            }
        }
    }
}
