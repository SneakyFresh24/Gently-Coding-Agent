"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const HNSWIndex_1 = require("../src/agent/retrieval/HNSWIndex");
const RetrievalBenchmarks_1 = require("../src/agent/retrieval/RetrievalBenchmarks");
const TransformersEmbeddingProvider_1 = require("../src/agent/retrieval/TransformersEmbeddingProvider");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const vitest_1 = require("vitest");
async function runBenchmark() {
    console.log('🚀 Starting Retrieval Benchmark Suite...');
    const persistenceDir = path.join(process.cwd(), '.gently', 'benchmark-data');
    await fs.mkdir(persistenceDir, { recursive: true });
    // 1. Setup Provider
    const provider = new TransformersEmbeddingProvider_1.TransformersEmbeddingProvider();
    // 2. Setup Index
    const index = new HNSWIndex_1.HNSWIndex({
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
    const bench = new RetrievalBenchmarks_1.RetrievalBenchmarks();
    // Use some actual embeddings for queries
    const queryTexts = ["how to sort", "file reading", "react hooks"];
    const queryVectors = await provider.embedBatch(queryTexts);
    await bench.runHNSWMetrics(index, queryVectors, {
        exportJson: true,
        testQuantization: true
    });
    console.log('✅ Benchmark finished.');
}
(0, vitest_1.describe)('Retrieval Benchmarks', () => {
    (0, vitest_1.it)('should run HNSW metrics successfully', async () => {
        await runBenchmark();
    }, 300000); // 5 min timeout for model loading
});
//# sourceMappingURL=benchmark-retrieval.test.js.map