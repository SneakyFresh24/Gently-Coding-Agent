import { HNSWIndex } from '../src/agent/retrieval/HNSWIndex';
import { RetrievalBenchmarks } from '../src/agent/retrieval/RetrievalBenchmarks';
import { TransformersEmbeddingProvider } from '../src/agent/retrieval/TransformersEmbeddingProvider';
import * as path from 'path';
import * as fs from 'fs/promises';
import { describe, it } from 'vitest';

async function runBenchmark() {
    console.log('🚀 Starting Retrieval Benchmark Suite...');

    const persistenceDir = path.join(process.cwd(), '.gently', 'benchmark-data');
    await fs.mkdir(persistenceDir, { recursive: true });

    // 1. Setup Provider
    const provider = new TransformersEmbeddingProvider();

    // 2. Setup Index
    const index = new HNSWIndex({
        dimensions: 384, // BGE-Small/M3 default
        persistenceDir,
        quantize: 'int8'
    });
    await index.initialize();

    // 3. Generate some dummy/test data if index is empty
    const stats = index.getStats();
    if (stats.count === 0) {
        console.log('[Benchmark] Index is empty. Adding test documents...');
        const testTexts = [
            "function sortArray(arr) { return arr.sort(); }",
            "class FileManager { constructor() {} readFile() {} }",
            "import { useState } from 'react';",
            "const logger = (msg) => console.log(msg);",
            "export interface User { id: string; name: string; }"
        ];

        const embeddings = await provider.embedBatch(testTexts);
        const docs = testTexts.map((text, i) => ({
            id: `test-${i}`,
            content: text,
            embedding: embeddings[i],
            language: 'typescript',
            metadata: { startLine: 1, endLine: 1 }
        }));

        await index.addDocuments(docs);
    }

    // 4. Run Benchmarks
    const bench = new RetrievalBenchmarks();

    // Use some actual embeddings for queries
    const queryTexts = ["how to sort", "file reading", "react hooks"];
    const queryVectors = await provider.embedBatch(queryTexts);

    await bench.runHNSWMetrics(index, queryVectors, {
        exportJson: true,
        testQuantization: true
    });

    console.log('✅ Benchmark finished.');
}

describe('Retrieval Benchmarks', () => {
    it('should run HNSW metrics successfully', async () => {
        await runBenchmark();
    }, 300000); // 5 min timeout for model loading
});
