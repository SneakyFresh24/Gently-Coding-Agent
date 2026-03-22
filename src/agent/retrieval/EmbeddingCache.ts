import { LRUCache } from 'lru-cache';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CacheOptions {
    persistenceDir: string;
    maxMemoryEntries?: number;
    ttlDays?: number;
    maxMemoryMB?: number;
    flushDebounceMs?: number;
}

type CacheMode = 'sqljs' | 'memory-only';

interface DbRow {
    embeddingBlob: Uint8Array;
    timestamp: number;
}

export class EmbeddingCache {
    private SQL: SqlJsStatic | null = null;
    private db: Database | null = null;
    private mode: CacheMode = 'memory-only';
    private memoryCache: LRUCache<string, number[]>;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;
    private readonly dbPath: string;
    private readonly ttlMs: number;
    private readonly maxMemoryBytes: number;
    private readonly flushDebounceMs: number;
    private nativeHasherClass: any = null;
    private hasNativeHasher: boolean = false;
    private degradedReason: string | null = null;
    private warnedDegradedState: boolean = false;
    private dirty: boolean = false;
    private flushTimer: NodeJS.Timeout | null = null;
    private writeChain: Promise<void> = Promise.resolve();
    private flushInProgress: boolean = false;

    constructor(options: CacheOptions) {
        this.ttlMs = (options.ttlDays || 30) * 24 * 60 * 60 * 1000;
        this.dbPath = path.join(options.persistenceDir, 'embeddings.db');
        this.maxMemoryBytes = (options.maxMemoryMB || 512) * 1024 * 1024;
        this.flushDebounceMs = options.flushDebounceMs || 5000;

        this.memoryCache = new LRUCache<string, number[]>({
            max: options.maxMemoryEntries || 2000,
            maxSize: this.maxMemoryBytes,
            sizeCalculation: (value, key) => this.estimateEntrySize(key, value),
            ttl: this.ttlMs,
            updateAgeOnGet: true
        });

        try {
            const mod = require('xxhash-addon');
            this.nativeHasherClass = mod.XXHash64;
            this.hasNativeHasher = true;
            console.log('[EmbeddingCache] Native XXHash64 loaded ✓');
        } catch {
            console.warn('[EmbeddingCache] Native XXHash64 NOT found. Falling back to simple hash.');
        }

        this.initPromise = this.initialize(options.persistenceDir);
    }

    private async initialize(persistenceDir: string): Promise<void> {
        await fs.mkdir(persistenceDir, { recursive: true });

        try {
            const wasmPath = path.join(__dirname, 'sql-wasm.wasm');
            this.SQL = await initSqlJs({
                locateFile: (file: string) => (file === 'sql-wasm.wasm' ? wasmPath : path.join(__dirname, file))
            });

            await this.loadOrCreateDatabase();
            this.mode = 'sqljs';
            this.initialized = true;
            this.degradedReason = null;
            console.log(`[EmbeddingCache] sql.js initialized at ${this.dbPath}`);
        } catch (error) {
            this.enterMemoryOnlyMode('sql.js WASM failed to initialize', error);
        }
    }

    private async loadOrCreateDatabase(): Promise<void> {
        if (!this.SQL) {
            throw new Error('sql.js not initialized');
        }

        if (await this.fileExists(this.dbPath)) {
            const fileBuffer = await fs.readFile(this.dbPath);
            this.db = new this.SQL.Database(new Uint8Array(fileBuffer));
        } else {
            this.db = new this.SQL.Database();
        }

        this.ensureSchema();
    }

    private ensureSchema(): void {
        if (!this.db) return;
        this.db.run(`
            CREATE TABLE IF NOT EXISTS embeddings (
                cache_key TEXT PRIMARY KEY,
                embedding_blob BLOB NOT NULL,
                timestamp INTEGER NOT NULL
            )
        `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_timestamp ON embeddings(timestamp)`);
    }

    private enterMemoryOnlyMode(reason: string, error?: unknown): void {
        this.mode = 'memory-only';
        this.db = null;
        this.SQL = null;
        this.degradedReason = reason;
        this.initialized = true;
        this.warnMemoryOnlyMode(error);
    }

    private warnMemoryOnlyMode(error?: unknown): void {
        if (this.warnedDegradedState) return;
        this.warnedDegradedState = true;
        console.warn(
            `[EmbeddingCache] MEMORY-ONLY mode active. Reason: ${this.degradedReason}. ` +
            'Embeddings will remain in RAM only until restart.'
        );
        if (error) {
            console.warn('[EmbeddingCache] sql.js initialization failure:', error);
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

    private estimateEntrySize(key: string, embedding: number[]): number {
        // Approximation: UTF-16 key + Float32 embedding + small object overhead.
        return (key.length * 2) + (embedding.length * 4) + 64;
    }

    private getApproxMemoryUsage(): number {
        return this.memoryCache.calculatedSize;
    }

    private shouldCompactMemory(): boolean {
        return this.getApproxMemoryUsage() > this.maxMemoryBytes;
    }

    private trimMemoryCache(): void {
        const target = Math.floor(this.maxMemoryBytes * 0.9);
        let guard = 0;
        while (this.memoryCache.calculatedSize > target && guard < 50_000) {
            const popped = this.memoryCache.pop();
            if (!popped) break;
            guard++;
        }
    }

    private async enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(operation, operation);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }

    private scheduleFlush(): void {
        if (this.mode !== 'sqljs') return;
        this.dirty = true;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.flushTimer = setTimeout(() => {
            void this.enqueueWrite(async () => {
                await this.flushToDiskUnsafe();
            });
        }, this.flushDebounceMs);
    }

    private async flushToDiskUnsafe(force: boolean = false): Promise<void> {
        if (this.mode !== 'sqljs' || !this.db) return;
        if (!this.dirty && !force) return;
        if (this.flushInProgress) return;
        this.flushInProgress = true;
        try {
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
            const exported = this.db.export();
            await fs.writeFile(this.dbPath, Buffer.from(exported));
            this.dirty = false;
        } finally {
            this.flushInProgress = false;
        }
    }

    private maybeTriggerCompaction(): void {
        if (!this.shouldCompactMemory()) return;
        void this.enqueueWrite(async () => {
            await this.flushAndCompactUnsafe();
        });
    }

    private async flushAndCompactUnsafe(): Promise<void> {
        if (this.mode !== 'sqljs' || !this.db) {
            this.trimMemoryCache();
            return;
        }

        const expiryCutoff = Date.now() - this.ttlMs;
        this.db.run('DELETE FROM embeddings WHERE timestamp < ?', [expiryCutoff]);
        this.scheduleFlush();
        await this.flushToDiskUnsafe(true);
        this.trimMemoryCache();
    }

    private normalizeBlob(raw: unknown): Uint8Array | null {
        if (raw instanceof Uint8Array) return raw;
        if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
        if (Array.isArray(raw)) return Uint8Array.from(raw as number[]);
        if (raw && typeof (raw as any).buffer === 'object') {
            const view = raw as { buffer: ArrayBufferLike; byteOffset?: number; byteLength?: number };
            const offset = view.byteOffset || 0;
            const len = view.byteLength || 0;
            return new Uint8Array(view.buffer as ArrayBuffer, offset, len || undefined);
        }
        return null;
    }

    private encodeEmbedding(embedding: number[]): Uint8Array {
        const floatArray = Float32Array.from(embedding);
        return new Uint8Array(floatArray.buffer);
    }

    private decodeEmbedding(blob: Uint8Array): number[] {
        const byteOffset = blob.byteOffset;
        const remainder = blob.byteLength % 4;
        const effectiveLength = remainder === 0 ? blob.byteLength : blob.byteLength - remainder;
        const view = new Float32Array(blob.buffer, byteOffset, effectiveLength / 4);
        return Array.from(view);
    }

    private readFromSqlJs(key: string): DbRow | null {
        if (!this.db) return null;
        const statement = this.db.prepare(
            'SELECT embedding_blob, timestamp FROM embeddings WHERE cache_key = ? LIMIT 1'
        );
        try {
            statement.bind([key]);
            if (!statement.step()) return null;
            const row = statement.getAsObject() as Record<string, unknown>;
            const blob = this.normalizeBlob(row.embedding_blob);
            const timestamp = Number(row.timestamp || 0);
            if (!blob) return null;
            return { embeddingBlob: blob, timestamp };
        } finally {
            statement.free();
        }
    }

    private async writeSingleUnsafe(key: string, embedding: number[], timestamp: number): Promise<void> {
        if (this.mode !== 'sqljs' || !this.db) return;
        const blob = this.encodeEmbedding(embedding);
        this.db.run(
            'INSERT OR REPLACE INTO embeddings (cache_key, embedding_blob, timestamp) VALUES (?, ?, ?)',
            [key, blob, timestamp]
        );
        this.scheduleFlush();
    }

    private async writeBatchUnsafe(items: Array<{ key: string; embedding: number[]; timestamp: number }>): Promise<void> {
        if (this.mode !== 'sqljs' || !this.db || items.length === 0) return;
        this.db.run('BEGIN TRANSACTION');
        try {
            const statement = this.db.prepare(
                'INSERT OR REPLACE INTO embeddings (cache_key, embedding_blob, timestamp) VALUES (?, ?, ?)'
            );
            for (const item of items) {
                statement.run([item.key, this.encodeEmbedding(item.embedding), item.timestamp]);
            }
            statement.free();
            this.db.run('COMMIT');
            this.scheduleFlush();
        } catch (error) {
            this.db.run('ROLLBACK');
            throw error;
        }
    }

    private async deleteKeyUnsafe(key: string): Promise<void> {
        if (this.mode !== 'sqljs' || !this.db) return;
        this.db.run('DELETE FROM embeddings WHERE cache_key = ?', [key]);
        this.scheduleFlush();
    }

    /**
     * Generates a fast hash key for the content
     */
    private generateKey(content: string, modelName: string): string {
        if (this.hasNativeHasher && this.nativeHasherClass) {
            try {
                const hasher = new this.nativeHasherClass(Buffer.from('gentlyv1'));
                hasher.update(Buffer.from(content));
                const hash = hasher.digest().toString('hex');
                return `${modelName}:${hash}`;
            } catch {
                this.hasNativeHasher = false;
            }
        }

        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return `${modelName}:fb-${hash.toString(16)}`;
    }

    /**
     * Get embedding from cache
     */
    async get(content: string, modelName: string): Promise<number[] | null> {
        if (!this.initialized) await this.initPromise;
        if (this.mode === 'memory-only') {
            this.warnMemoryOnlyMode();
        }

        const key = this.generateKey(content, modelName);
        const cached = this.memoryCache.get(key);
        if (cached) return cached;

        if (this.mode === 'sqljs' && this.db) {
            const row = this.readFromSqlJs(key);
            if (!row) return null;
            if (Date.now() - row.timestamp > this.ttlMs) {
                await this.enqueueWrite(async () => {
                    await this.deleteKeyUnsafe(key);
                });
                return null;
            }
            const embedding = this.decodeEmbedding(row.embeddingBlob);
            this.memoryCache.set(key, embedding);
            return embedding;
        }

        return null;
    }

    /**
     * Set embedding in cache
     */
    async set(content: string, modelName: string, embedding: number[]): Promise<void> {
        if (!this.initialized) await this.initPromise;
        if (this.mode === 'memory-only') {
            this.warnMemoryOnlyMode();
        }

        const key = this.generateKey(content, modelName);
        const timestamp = Date.now();
        this.memoryCache.set(key, embedding);

        await this.enqueueWrite(async () => {
            await this.writeSingleUnsafe(key, embedding, timestamp);
        });
        this.maybeTriggerCompaction();
    }

    /**
     * Batch set embeddings
     */
    async setBatch(items: Array<{ content: string; embedding: number[] }>, modelName: string): Promise<void> {
        if (!this.initialized) await this.initPromise;
        if (this.mode === 'memory-only') {
            this.warnMemoryOnlyMode();
        }

        const now = Date.now();
        const prepared = items.map(item => {
            const key = this.generateKey(item.content, modelName);
            this.memoryCache.set(key, item.embedding);
            return { key, embedding: item.embedding, timestamp: now };
        });

        await this.enqueueWrite(async () => {
            await this.writeBatchUnsafe(prepared);
        });
        this.maybeTriggerCompaction();
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        if (!this.initialized) await this.initPromise;
        this.memoryCache.clear();
        await this.enqueueWrite(async () => {
            if (this.mode === 'sqljs' && this.db) {
                this.db.run('DELETE FROM embeddings');
                this.scheduleFlush();
                await this.flushToDiskUnsafe(true);
            }
        });
    }

    /**
     * Close the cache
     */
    async close(): Promise<void> {
        if (!this.initialized) await this.initPromise;
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        await this.writeChain;
        await this.enqueueWrite(async () => {
            if (this.mode === 'sqljs') {
                await this.flushToDiskUnsafe(true);
            }
        });
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}
