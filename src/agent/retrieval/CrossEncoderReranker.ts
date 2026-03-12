import { pipeline } from '@xenova/transformers';
import { RerankInput, SearchResult } from './types';
import { RetrievalConfig } from './RetrievalConfig';

export interface RerankerOptions {
    modelName?: string;
    batchSize?: number;
    // minicpm-layerwise specific: use top layers for better latency/performance balance
    numLayers?: number;
    normalizeScores?: boolean;
}

export class CrossEncoderReranker {
    private model: any = null;
    private modelName: string;
    private batchSize: number;
    private normalizeScores: boolean;
    private isInitialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    constructor(options: RerankerOptions = {}) {
        this.modelName = options.modelName || RetrievalConfig.reranker.modelName;
        this.batchSize = options.batchSize || RetrievalConfig.reranker.batchSize;
        this.normalizeScores = options.normalizeScores ?? true;
    }

    /**
     * Initialize the reranker model
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                console.log(`[CrossEncoder] Loading model: ${this.modelName}...`);
                const startTime = Date.now();

                // Load the sequence-classification pipeline (standard for Cross-Encoders)
                // Using 'text-classification' as it's the correct way to handle Cross-Encoders in Transformers.js
                this.model = await pipeline('text-classification', this.modelName);

                console.log(`[CrossEncoder] Model loaded in ${Date.now() - startTime}ms`);
                this.isInitialized = true;
            } catch (error) {
                console.error('[CrossEncoder] Failed to load model:', error);
                throw error;
            }
        })();

        return this.initPromise;
    }

    /**
     * Pre-warm the model to reduce first-query latency
     */
    async preWarm(): Promise<void> {
        await this.initialize();
        console.log('[CrossEncoder] Pre-warming with realistic examples...');

        const warmupData = [
            { query: 'find sort function', doc: 'function sort(arr) { return arr.sort(); }' },
            { query: 'how to read file', doc: 'import * as fs from "fs"; const data = fs.readFileSync("test.txt");' }
        ];

        for (const item of warmupData) {
            await this.rerank(item.query, [{ id: 'warmup', content: item.doc }]);
        }
    }

    /**
     * Rerank candidates using Cross-Encoder
     */
    async rerank(query: string, documents: Array<{ id: string; content: string }>): Promise<Array<{ id: string; score: number }>> {
        if (!this.isInitialized) await this.initialize();
        if (documents.length === 0) return [];

        const startTime = Date.now();
        const results: Array<{ id: string; score: number }> = [];
        const subBatchSize = RetrievalConfig.reranker.subBatchSize || 8;

        // Process in sub-batches to prevent memory issues
        for (let i = 0; i < documents.length; i += subBatchSize) {
            const subBatch = documents.slice(i, i + subBatchSize);
            const inputs = subBatch.map(doc => [query, doc.content]);

            try {
                // 'text-classification' returns labels and scores
                const predictions = await (this.model as any)(inputs, {
                    topk: 1,
                    return_all_scores: false
                });

                for (let j = 0; j < subBatch.length; j++) {
                    const pred = Array.isArray(predictions) ? predictions[j] : predictions;

                    let score: number = 0;

                    if (pred && typeof pred.score === 'number') {
                        // bge-reranker-v2-m3 usually gives the probability directly
                        if (pred.label === 'LABEL_1' || pred.label === 'relevant') {
                            score = pred.score;
                        } else if (pred.label === 'LABEL_0' || pred.label === 'not_relevant') {
                            score = 1 - pred.score; // Inverted if LABEL_0 was the "higher" confidence
                        } else {
                            // Fallback for models that might not use LABEL_0/1
                            score = pred.score;
                        }
                    } else {
                        console.warn(`[CrossEncoderReranker] Unexpected prediction format for ${subBatch[j].id}:`, pred);
                        score = 0;
                    }

                    results.push({ id: subBatch[j].id, score });
                }
            } catch (error) {
                console.error('[CrossEncoderReranker] Batch processing error:', error);
                for (const doc of subBatch) {
                    results.push({ id: doc.id, score: 0 });
                }
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[CrossEncoderReranker] Reranked ${documents.length} docs in ${duration}ms`);

        // Apply normalization if requested
        if (this.normalizeScores) {
            results.forEach(r => {
                // Sigmoid normalization: 1 / (1 + exp(-x))
                // If the score is already in [0, 1], this might slightly squash it, 
                // but many cross-encoders return logits.
                r.score = 1 / (1 + Math.exp(-r.score));
            });
        }

        return results.sort((a, b) => b.score - a.score);
    }

    isReady(): boolean {
        return this.isInitialized;
    }
}
