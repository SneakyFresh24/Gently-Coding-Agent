import {
  HybridSearchOptions,
  HybridSearchResult,
  VectorDocument,
  SearchResult
} from './types';
import { HNSWIndex } from './HNSWIndex';
import { BM25Index } from './BM25Index';
import { CrossEncoderReranker } from './CrossEncoderReranker';
import { TransformersEmbeddingProvider } from './TransformersEmbeddingProvider';
import { RetrievalConfig } from './RetrievalConfig';

/**
 * Modernized Hybrid Retriever for 2026
 * 
 * Pipeline:
 * 1. Coarse Retrieval: Parallel search in HNSW (Dense) and BM25 (Lexical)
 * 2. Fusion: Reciprocal Rank Fusion (RRF) with configurable weights
 * 3. Precision Re-ranking: Cross-Encoder (bge-reranker-v2-m3)
 */
export class HybridRetriever {
  private hnsw: HNSWIndex;
  private bm25: BM25Index;
  private reranker: CrossEncoderReranker | null = null;
  private fileToChunks: Map<string, string[]> = new Map();
  private embeddingProvider: TransformersEmbeddingProvider;
  private rerankerEnabled: boolean = true;

  constructor(
    hnsw: HNSWIndex,
    bm25: BM25Index,
    embeddingProvider: TransformersEmbeddingProvider,
    reranker?: CrossEncoderReranker
  ) {
    this.hnsw = hnsw;
    this.bm25 = bm25;
    this.embeddingProvider = embeddingProvider;
    this.reranker = reranker || null;
  }

  /**
   * Pre-warm all components (loads models into memory/GPU)
   */
  async preWarm(): Promise<void> {
    await Promise.all([
      this.hnsw.initialize(), // NEW
      this.embeddingProvider.initialize(),
      this.reranker?.initialize() || Promise.resolve()
    ]);
    console.log('[HybridRetriever] Pre-warming complete');
  }

  /**
   * Compatibility method for CodebaseIndexer
   */
  async initializeHNSW(): Promise<void> {
    await this.hnsw.initialize();
  }

  /**
   * Hybrid Search with Re-ranking
   */
  async search(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
    const topK = options.limit || options.topK || RetrievalConfig.hybrid.topK;
    const rerankCount = options.rerankCount || RetrievalConfig.hybrid.rerankCount;

    // Resolve weights (alpha takes priority, then legacy weights)
    let denseWeight = RetrievalConfig.hybrid.alpha;
    if (options.alpha !== undefined) {
      denseWeight = options.alpha;
    } else if (options.vectorWeight !== undefined) {
      denseWeight = options.vectorWeight;
    } else if (options.bm25Weight !== undefined) {
      denseWeight = 1 - options.bm25Weight;
    }
    const lexicalWeight = 1 - denseWeight;

    const startTime = Date.now();
    let embeddingGenerationMs = 0;
    let hnswSearchMs = 0;
    let bm25SearchMs = 0;
    let rerankerMs = 0;

    // Stage 0: Dynamic efSearch scaling based on index size
    const stats = this.hnsw.getStats();
    let efSearch = RetrievalConfig.hybrid.efSearch.small;
    if (stats.count > 100000 || options.highRecall) {
      efSearch = RetrievalConfig.hybrid.efSearch.large;
    } else if (stats.count > 20000) {
      efSearch = RetrievalConfig.hybrid.efSearch.medium;
    }
    this.hnsw.setEfSearch(efSearch);

    // Stage 1: Parallel Coarse Retrieval
    const [denseResults, lexicalResults] = await Promise.all([
      this.searchDense(query, rerankCount).then((result) => {
        embeddingGenerationMs = result.embeddingGenerationMs;
        hnswSearchMs = result.hnswSearchMs;
        return result.results;
      }),
      (async () => {
        const start = Date.now();
        const results = await this.bm25.search(query, rerankCount);
        bm25SearchMs = Date.now() - start;
        return results;
      })()
    ]);

    // Stage 2: Reciprocal Rank Fusion (RRF)
    const fusedResults = this.fuseResults(denseResults, lexicalResults, denseWeight, lexicalWeight);

    // Take top candidates for re-ranking
    const candidates = fusedResults.slice(0, rerankCount);

    // Stage 3: (Optional) Cross-Encoder Re-ranking
    let finalResults: HybridSearchResult[];
    if (this.reranker && this.rerankerEnabled && candidates.length > 0) {
      const rerankStart = Date.now();
      const reranked = await this.reranker.rerank(
        query,
        candidates.map(c => ({ id: c.id, content: c.content }))
      );
      rerankerMs = Date.now() - rerankStart;

      // Merge reranker scores back (weighted 0.8 Reranker / 0.2 RRF)
      finalResults = candidates.map((c, i) => {
        const rerankScore = reranked[i]?.score || 0;
        const hybridScore = (c.score * 0.2) + (rerankScore * 0.8);
        return {
          ...c,
          score: hybridScore,
          rerankScore
        };
      });

      // Sort again by final score
      finalResults.sort((a, b) => b.score - a.score);
    } else {
      finalResults = candidates;
    }

    const totalTime = Date.now() - startTime;
    console.log(`[HybridRetriever] Search complete in ${totalTime}ms (Dense: ${denseResults.length}, Lexical: ${lexicalResults.length})`);
    console.log(JSON.stringify({
      'perf.phase': 'hybrid_retriever_search',
      retrieval_stage: 'complete',
      duration_ms: totalTime,
      embedding_generation_ms: embeddingGenerationMs,
      hnsw_search_ms: hnswSearchMs,
      bm25_search_ms: bm25SearchMs,
      reranker_ms: rerankerMs,
      reranker_enabled: this.rerankerEnabled
    }));

    return finalResults.slice(0, topK);
  }

  private async searchDense(query: string, k: number): Promise<{ results: SearchResult[]; embeddingGenerationMs: number; hnswSearchMs: number }> {
    const embeddingStart = Date.now();
    const embedding = await this.embeddingProvider.embed(query);
    const embeddingGenerationMs = Date.now() - embeddingStart;
    const hnswStart = Date.now();
    const results = await this.hnsw.search(embedding, k);
    const hnswSearchMs = Date.now() - hnswStart;
    return {
      embeddingGenerationMs,
      hnswSearchMs,
      results: results.map(r => ({
      id: r.id,
      score: r.score,
      content: (r.metadata as any)?.content || '',
      metadata: r.metadata
      }))
    };
  }

  setRerankerEnabled(enabled: boolean): void {
    this.rerankerEnabled = enabled;
  }

  /**
   * Fuses results using RRF (Reciprocal Rank Fusion)
   */
  private fuseResults(
    dense: SearchResult[],
    lexical: SearchResult[],
    wDense: number,
    wLexical: number
  ): HybridSearchResult[] {
    const k = 60; // Smoothing constant for RRF
    const scores = new Map<string, { score: number; doc: SearchResult }>();

    // Process dense
    dense.forEach((doc, i) => {
      const rrfScore = wDense * (1 / (k + (i + 1)));
      scores.set(doc.id, { score: rrfScore, doc });
    });

    // Process lexical
    lexical.forEach((doc, i) => {
      const rrfScore = wLexical * (1 / (k + (i + 1)));
      const existing = scores.get(doc.id);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(doc.id, { score: rrfScore, doc });
      }
    });

    return Array.from(scores.values())
      .map(({ score, doc }) => ({
        id: doc.id,
        filePath: (doc.metadata as any)?.path || doc.id,
        content: (doc.metadata as any)?.content || '',
        score,
        reason: (doc as any).matchedTerms || [],
        metadata: doc.metadata
      }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Indexed management
   */
  async addDocument(doc: VectorDocument): Promise<void> {
    await Promise.all([
      this.hnsw.addDocument(doc),
      this.bm25.addDocument(doc)
    ]);
  }

  async addDocuments(docs: VectorDocument[]): Promise<void> {
    await Promise.all([
      this.hnsw.addDocuments(docs),
      ...docs.map(doc => this.bm25.addDocument(doc))
    ]);
  }

  removeDocument(id: string): void {
    this.hnsw.removeDocument(id);
  }

  /**
   * Compatibility methods for CodebaseIndexer
   */
  async indexFile(fileIndex: any): Promise<void> {
    // Generate chunks if they don't exist
    const chunks = fileIndex.chunks || [{
      id: fileIndex.path,
      content: fileIndex.content,
      language: fileIndex.language,
      metadata: { path: fileIndex.path }
    }];

    const chunkIds: string[] = [];
    const docs: VectorDocument[] = chunks.map((c: any) => {
      const id = c.id || `${fileIndex.path}:${c.startLine}`;
      chunkIds.push(id);
      return {
        id,
        content: c.content,
        language: fileIndex.language,
        metadata: {
          path: fileIndex.path,
          startLine: c.startLine,
          endLine: c.endLine,
          type: c.type
        }
      };
    });

    // Track chunks per file for later deletion
    this.fileToChunks.set(fileIndex.path, chunkIds);

    await this.addDocuments(docs);
  }

  async removeFile(filePath: string): Promise<void> {
    const chunkIds = this.fileToChunks.get(filePath);

    if (!chunkIds) {
      console.warn(`[HybridRetriever] Fallback: No chunk mapping found for ${filePath}. Skipping deletion.`);
      return;
    }

    console.log(`[HybridRetriever] Removing ${chunkIds.length} chunks for: ${filePath}`);

    // Efficient batch removal
    await this.hnsw.removeDocuments(chunkIds);
    this.bm25.removeDocuments?.(chunkIds);

    this.fileToChunks.delete(filePath);
  }

  setDependencyResolver(resolver: any): void {
    // Placeholder for compatibility
  }

  getStats() {
    return this.hnsw.getStats();
  }

  async clear(): Promise<void> {
    await this.hnsw.clear();
    this.bm25.clear();
  }
}
