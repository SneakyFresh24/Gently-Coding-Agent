/**
 * Shared types and interfaces for the Retrieval system
 */

export interface VectorDocument {
    id: string;             // Typically the file path
    content: string;        // File content or chunk content
    embedding?: number[];   // float32 embedding
    quantizedEmbedding?: Int8Array; // int8 scalar quantized embedding
    language: string;
    metadata?: Record<string, any>;
    chunks?: VectorChunk[];
}

export interface VectorChunk {
    id: string;
    content: string;
    embedding: number[];
    startLine: number;
    endLine: number;
    metadata?: Record<string, any>;
}

export interface SearchResult {
    id: string;
    score: number;
    metadata?: Record<string, any>;
}

export interface BM25SearchResult extends SearchResult {
    matchedTerms: string[];
}

export interface HNSWSearchResult extends SearchResult {
    distance: number;
}

export interface HybridSearchResult {
    id: string;
    filePath: string; // Compatibility with CodebaseIndexer
    content: string; // The content or snippet
    score: number;   // Final fused/reranked score
    rerankScore?: number;
    reason: string[]; // Reasons for the match
    metadata?: Record<string, any>;
}

export interface HybridSearchOptions {
    limit?: number;
    topK?: number;         // Compatibility with CodebaseIndexer
    alpha?: number;        // Weight for dense (0.0 - 1.0)
    vectorWeight?: number; // Compatibility
    bm25Weight?: number;   // Compatibility
    rerankCount?: number;  // How many candidates to rerank
    highRecall?: boolean;  // Flag to increase efSearch
    filter?: (metadata: any) => boolean;
    includeSymbols?: boolean;
    minScore?: number;
}

export interface EmbeddingProvider {
    embed(text: string): Promise<number[]>;
    embedBatch(texts: string[]): Promise<number[][]>;
    isReady(): boolean;
}

export interface RerankInput {
    query: string;
    documents: Array<{
        id: string;
        content: string;
    }>;
}
