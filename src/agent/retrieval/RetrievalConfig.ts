import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Retrieval System Configuration
 * Optimized for 2026 performance standards.
 */
export const RetrievalConfig = {
    // HNSW Vector Index Settings
    hnsw: {
        dimensions: 384, // Default for MiniLM
        maxElements: 50000,
        m: 16,
        efConstruction: 200,
        quantization: (process.env.RETRIEVAL_QUANTIZATION as 'int8' | 'float32') || 'int8',
        recallThreshold: 0.93, // Min acceptable recall relative to float32
        persistenceDir: './.gently/retrieval/hnsw',
        int8OversampleFactor: 1.8,
        adaptiveOversample: true,
        calibrationSamples: 500,
        sizeProfiles: {
            small: { m: 16, efC: 200, limit: 10000 },
            medium: { m: 24, efC: 300, limit: 50000 },
            large: { m: 32, efC: 400, limit: 200000 },
            xlarge: { m: 40, efC: 500, limit: Infinity }
        }
    },

    // BM25 Lexical Index Settings
    bm25: {
        variant: 'BM25+', // BM25, BM25+, BM25L
        autoTune: true,   // Signature Move: Enable auto-tuning
        delta: 1.0,       // Delta parameter for BM25+
        k1: 1.6,          // Optimised for code (standard 1.2)
        b: 0.75,
        useNGrams: true,
        symbolBoostFactor: 3.0, // Default structural boost
        goldenQueries: [
            { q: "sort array", expected: ["sort.ts", "utils.ts"] },
            { q: "read file sync", expected: ["fs.ts"] }
        ]
    },

    // Cross-Encoder Reranker Settings
    reranker: {
        enabled: true,
        modelName: process.env.RETRIEVAL_RERANKER_MODEL || 'Xenova/bge-reranker-v2-m3',
        batchSize: 16,
        subBatchSize: 8, // Sub-batching to prevent OOM
        // minicpm-layerwise optimization: usually top 8-12 layers are enough
        numLayers: 12
    },

    // Hybrid Orchestration Settings
    hybrid: {
        alpha: 0.6, // Weight for dense retrieval (0.0 - 1.0)
        rerankCount: 40,
        topK: 10,
        // Dynamic efSearch limits
        efSearch: {
            small: 60,
            medium: 80,
            large: 120
        }
    },

    // Performance Benchmarking Targets
    benchmarks: {
        coldStartMs: 5000,
        warmP95Ms: 250
    },

    regexSearch: {
        enabled: true,
        queryTimeoutMs: 1200,
        maxCandidates: 300,
        maxVerifiedFiles: 120,
        maxMatches: 200,
        indexDir: '.gently/regex-index',
        metadataFile: 'metadata.json',
        hashFile: 'file-hashes.json'
    }
};
