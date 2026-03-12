import { HNSWIndex } from './HNSWIndex';
import { RetrievalConfig } from './RetrievalConfig';
import { VectorDocument } from './types';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * High-Precision Retrieval Benchmarks
 * Evaluates the 9.5+ HNSW implementation with advanced metrics and performance analysis.
 */
export class RetrievalBenchmarks {
    async runHNSWMetrics(index: HNSWIndex, testVectors: number[][], options: { exportJson?: boolean, testQuantization?: boolean } = {}): Promise<any> {
        console.log('\n--- HNSW 9.5+ Advanced Precision Benchmark ---');

        const testCount = Math.min(testVectors.length, 100);
        if (testCount === 0) {
            console.error('[Benchmark] No test vectors provided.');
            return;
        }

        const ks = [5, 10, 20, 50];
        const results: any = {
            metrics: {},
            efTradeoff: [],
            resourceUsage: {}
        };

        // 1. Generate Ground Truth (using high EF-Search for "near-perfect" retrieval)
        console.log(`[Benchmark] Generating Ground Truth for ${testCount} queries...`);
        const groundTruth = new Map<number, string[]>();

        // Save current EF to restore later
        const originalEf = (index as any).options.efSearch || 60;

        index.setEfSearch(400); // Max precision for ground truth
        for (let i = 0; i < testCount; i++) {
            const res = await index.search(testVectors[i], 50); // Get top 50 as baseline
            groundTruth.set(i, res.map(r => r.id));
        }

        // 2. Measure Metrics@K
        console.log('[Benchmark] Calculating Recall@K, MRR, and NDCG...');
        for (const k of ks) {
            let recallSum = 0;
            let mrrSum = 0;
            let ndcgSum = 0;

            for (let i = 0; i < testCount; i++) {
                const query = testVectors[i];
                const searchRes = await index.search(query, k);
                const retrievedIds = searchRes.map(r => r.id);
                const relevant = groundTruth.get(i) || [];

                recallSum += this.calculateRecall(relevant.slice(0, k), retrievedIds);
                mrrSum += this.calculateMRR(relevant, retrievedIds);
                ndcgSum += this.calculateNDCG(relevant.slice(0, k), retrievedIds);
            }

            results.metrics[`Recall@${k}`] = (recallSum / testCount).toFixed(4);
            results.metrics[`MRR@${k}`] = (mrrSum / testCount).toFixed(4);
            results.metrics[`NDCG@${k}`] = (ndcgSum / testCount).toFixed(4);
        }

        console.table(results.metrics);

        // 3. Quantization Comparison (Float32 vs Int8)
        if (options.testQuantization) {
            if (testVectors.length > 50) {
                console.log('\n[Benchmark] ⚠️ Risk-Check: Large test set detected for quantization. Limiting to 50 samples to avoid slow re-indexing.');
            }

            console.log('\n[Benchmark] 🧪 Comparing Float32 vs Int8 Precision...');
            const quantSuccess = await index.validateQuantization(testVectors.slice(0, 50));

            results.quantization = {
                success: quantSuccess,
                status: quantSuccess ? '✅ Int8 Validated' : '❌ Int8 Recall too low (Fallback applied)'
            };
            console.log(`Quantization Status: ${results.quantization.status}`);
        }

        // 3. EF-Search Trade-off Table
        const efValues = [40, 80, 120, 200, 400];
        console.log('\n[Benchmark] Running EF-Search Trade-off Analysis...');

        for (const ef of efValues) {
            index.setEfSearch(ef);
            const start = Date.now();

            // Latency check (30 iterations)
            for (let i = 0; i < 30; i++) {
                await index.search(testVectors[i % testCount], 10);
            }
            const avgLat = (Date.now() - start) / 30;

            // Recall check (all available queries, up to 20)
            let recSum = 0;
            const recallCount = Math.min(testCount, 20);
            for (let i = 0; i < recallCount; i++) {
                const res = await index.search(testVectors[i], 10);
                const ids = res.map(r => r.id);
                recSum += this.calculateRecall(groundTruth.get(i)!.slice(0, 10), ids);
            }
            const rec = recSum / recallCount;

            results.efTradeoff.push({
                efSearch: ef,
                'Latency (ms)': avgLat.toFixed(2),
                'Recall@10': rec.toFixed(4),
                'Status': (avgLat < 250 && rec > 0.94) ? '✅ Target' : '⚠️ Deviates'
            });
        }

        console.table(results.efTradeoff);

        // 4. Resource Usage
        results.resourceUsage = {
            memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            indexSize: index.getStats().count
        };
        console.log(`Memory Usage: ${results.resourceUsage.memoryMB}MB`);

        // 5. JSON Export
        if (options.exportJson) {
            try {
                const outDir = path.join(process.cwd(), '.gently', 'benchmarks');
                await fs.mkdir(outDir, { recursive: true });
                const outPath = path.join(outDir, `retrieval_benchmark_${Date.now()}.json`);
                await fs.writeFile(outPath, JSON.stringify(results, null, 2));
                console.log(`[Benchmark] Results exported to: ${outPath}`);
            } catch (err) {
                console.error('[Benchmark] Failed to export JSON:', err);
            }
        }

        // Restore original state
        index.setEfSearch(originalEf);
        console.log('-------------------------------------\n');

        return results;
    }

    private calculateRecall(gt: string[], measured: string[]): number {
        if (gt.length === 0) return 0;
        const measuredSet = new Set(measured);
        const matches = gt.filter(id => measuredSet.has(id)).length;
        return matches / gt.length;
    }

    private calculateMRR(gt: string[], measured: string[]): number {
        if (gt.length === 0) return 0;
        for (let i = 0; i < measured.length; i++) {
            if (measured[i] === gt[0]) return 1 / (i + 1);
        }
        return 0;
    }

    private calculateNDCG(gt: string[], measured: string[]): number {
        if (gt.length === 0) return 0;
        let dcg = 0;
        let idcg = 0;
        const measuredSet = new Set(measured);

        for (let i = 0; i < gt.length; i++) {
            const rel = measuredSet.has(gt[i]) ? 1 : 0;
            dcg += rel / Math.log2(i + 2);
            idcg += 1 / Math.log2(i + 2);
        }
        return idcg === 0 ? 0 : dcg / idcg;
    }
}
