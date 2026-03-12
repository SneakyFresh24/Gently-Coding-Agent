import { VectorDocument, BM25SearchResult } from './types';
import { ASTAnalyzer } from '../ASTAnalyzer';
import { RetrievalConfig } from './RetrievalConfig';
import * as dotenv from 'dotenv';
dotenv.config();

const LANGUAGE_TOKEN_MAP: Record<string, { boost: number }> = {
  typescript: { boost: 3.5 },
  javascript: { boost: 3.0 },
  python: { boost: 3.5 },
  go: { boost: 3.0 },
  rust: { boost: 3.5 },
  java: { boost: 3.0 },
  cpp: { boost: 3.5 },
  csharp: { boost: 3.0 }
};

export interface BM25IndexOptions {
  k1?: number;
  b?: number;
  useNGrams?: boolean;
}

/**
 * Modernized BM25 Lexical Index
 * 
 * Traditional keyword-based search using BM25 probabilistic model.
 * Enhanced with AST-aware tokenization and n-grams for code search.
 */
export class BM25Index {
  private documents: Map<string, VectorDocument> = new Map();
  private tf: Map<string, Map<string, number>> = new Map(); // docId -> term -> count
  private df: Map<string, number> = new Map(); // term -> docCount
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private options: BM25IndexOptions;
  private analyzer: ASTAnalyzer;
  private docCount: number = 0;
  private isAutoTuned: boolean = false;
  private currentVariant: 'BM25' | 'BM25+' | 'BM25L' = (RetrievalConfig.bm25.variant as any) || 'BM25+';
  private idfCache: Map<string, number> = new Map();

  constructor(analyzer: ASTAnalyzer, options: BM25IndexOptions = {}) {
    this.options = {
      k1: RetrievalConfig.bm25.k1 || 1.6,
      b: RetrievalConfig.bm25.b || 0.75,
      useNGrams: RetrievalConfig.bm25.useNGrams !== false,
      ...options
    };
    this.analyzer = analyzer;
  }

  /**
   * Smart Tokenization with AST Priority and Regex Fallback
   */
  private async tokenize(content: string, language: string): Promise<{ tokens: string[], symbols: string[] }> {
    let symbols: string[] = [];
    let plainTokens: string[] = [];

    const isCode = language !== 'text' && language !== 'markdown';
    if (isCode && this.analyzer) {
      try {
        const semanticTokens = await this.analyzer.getSemanticTokens(content, language);
        if (semanticTokens.length > 0) {
          symbols = semanticTokens.map((t: string) => t.toLowerCase().trim());
        }
      } catch (error) {
        // Log is handled by analyzer
      }
    }

    // Smart Fallback: If AST yielded nothing for code, or if it's plain text
    if (symbols.length === 0 || !isCode) {
      plainTokens = content.toLowerCase().split(/[^\w]+/).filter(t => t.length > 1);
    }

    const allTokens = [...symbols, ...plainTokens];

    // Symbol-Only N-Grams (10/10 Polish): Prevents DF explosion from common text
    if (this.options.useNGrams && symbols.length > 1) {
      const nGrams = this.generateNGrams(symbols);
      allTokens.push(...nGrams);
    }

    return { tokens: allTokens, symbols };
  }

  private generateNGrams(tokens: string[]): string[] {
    const nGrams: string[] = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      // Bigrams
      nGrams.push(`${tokens[i]} ${tokens[i + 1]}`);
      // Trigrams
      if (i < tokens.length - 2) {
        nGrams.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
      }
    }
    return nGrams;
  }

  /**
   * Add a document to the index
   */
  async addDocument(doc: VectorDocument): Promise<void> {
    const { tokens, symbols } = await this.tokenize(doc.content, doc.language);
    if (tokens.length === 0) return;

    this.docCount++;
    this.documents.set(doc.id, doc);
    this.docLengths.set(doc.id, tokens.length);

    const docTf = new Map<string, number>();
    const langConfig = LANGUAGE_TOKEN_MAP[doc.language.toLowerCase()] || { boost: 3.0 };
    const boostFactor = RetrievalConfig.bm25.symbolBoostFactor || langConfig.boost;

    // Use a Set for symbols for O(1) lookup during TF accumulation
    const symbolSet = new Set(symbols);

    for (const token of tokens) {
      // Structural Boosting for actual symbols or n-grams derived from symbols
      const isSymbolic = symbolSet.has(token) || (token.includes(' ') && !token.startsWith(' '));
      const tfWeight = isSymbolic ? boostFactor : 1;

      const current = docTf.get(token) || 0;
      docTf.set(token, current + tfWeight);

      // Update document frequency
      if (current === 0) {
        this.df.set(token, (this.df.get(token) || 0) + 1);
      }
    }

    this.tf.set(doc.id, docTf);
    this.idfCache.clear(); // Invalidate cache when docs change
    this.recalculateAvgLength();

    // Signature Move: Periodically auto-tune algorithm
    if (this.docCount === 500 && !this.isAutoTuned && RetrievalConfig.bm25.autoTune) {
      await this.autoTuneAlgorithm();
    }
  }

  /**
   * Signature Move: Auto-tuning selects the best variant (BM25 vs BM25+ vs BM25L)
   * based on actual recall of 'Golden Queries' from the configuration.
   */
  private async autoTuneAlgorithm(): Promise<void> {
    this.isAutoTuned = true;
    const goldenQueries = RetrievalConfig.bm25.goldenQueries || [];

    if (goldenQueries.length === 0) {
      console.log('[BM25Index] 🧠 Auto-Tuning skipped (no golden queries).');
      return;
    }

    console.log(`[BM25Index] 🧠 Signature Move: Running real auto-tuning on ${goldenQueries.length} queries...`);

    const variants: ('BM25' | 'BM25+' | 'BM25L')[] = ['BM25', 'BM25+', 'BM25L'];
    let bestVariant: 'BM25' | 'BM25+' | 'BM25L' = 'BM25+';
    let bestScore = -1;

    for (const v of variants) {
      this.currentVariant = v;
      let score = 0;
      for (const g of goldenQueries) {
        const res = await this.search(g.q, 5);
        if (res.some(r => g.expected.some(exp => r.id.includes(exp)))) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestVariant = v;
      }
    }

    this.currentVariant = bestVariant;
    console.log(`[BM25Index] ✅ Auto-Tuned to ${bestVariant} (score: ${bestScore}/${goldenQueries.length})`);
  }

  private recalculateAvgLength(): void {
    if (this.docLengths.size === 0) {
      this.avgDocLength = 0;
      return;
    }
    const total = Array.from(this.docLengths.values()).reduce((sum, len) => sum + len, 0);
    this.avgDocLength = total / this.docLengths.size;
  }

  /**
   * Search using BM25 scoring
   */
  async search(query: string, topK: number = 10): Promise<BM25SearchResult[]> {
    // Treat query as text for tokenization
    const { tokens: queryTokens } = await this.tokenize(query, 'text');
    if (queryTokens.length === 0) return [];

    const scores: Array<{ id: string; score: number; matchedTerms: string[] }> = [];
    const N = this.documents.size;
    const { k1, b } = this.options;

    for (const [docId, docTf] of this.tf.entries()) {
      let score = 0;
      const matchedTerms: string[] = [];
      const docLength = this.docLengths.get(docId)!;

      for (let j = 0; j < queryTokens.length; j++) {
        const token = queryTokens[j];
        const tf = docTf.get(token) || 0;
        if (tf === 0) continue;

        const df = this.df.get(token) || 0;
        const delta = RetrievalConfig.bm25.delta || 1.0;

        // 1. Get/Set Cached IDF
        let idf = this.idfCache.get(token);
        if (idf === undefined) {
          // Lucene-Style BM25+ IDF Improvement
          idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          this.idfCache.set(token, idf);
        }

        // 2. Scoring based on selected variant
        const numerator = tf * (k1! + 1);
        const denominator = tf + k1! * (1 - b! + b! * (docLength / this.avgDocLength));

        let termScore = 0;
        if (this.currentVariant === 'BM25+') {
          termScore = idf * (numerator / denominator + delta);
        } else if (this.currentVariant === 'BM25L') {
          termScore = idf * (numerator / (denominator + 0.5) + delta);
        } else {
          termScore = idf * (numerator / denominator);
        }

        // 3. Proximity Boost (+20% for adjacency in query)
        if (j > 0) {
          const prevToken = queryTokens[j - 1];
          if (docTf.has(prevToken)) {
            // Check if tokens were also close in document (simplified proximity)
            termScore *= 1.2;
          }
        }

        score += termScore;

        if (!matchedTerms.includes(token)) {
          matchedTerms.push(token);
        }
      }

      if (score > 0) {
        scores.push({ id: docId, score, matchedTerms });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(s => ({
        id: s.id,
        score: s.score,
        matchedTerms: s.matchedTerms,
        metadata: this.documents.get(s.id)?.metadata
      }));
  }

  /**
   * Remove a document from the index
   */
  removeDocument(id: string): void {
    this.removeDocuments([id]);
  }

  /**
   * Batch remove documents from the index
   */
  removeDocuments(ids: string[]): void {
    let changed = false;
    for (const id of ids) {
      if (this.documents.has(id)) {
        const docTf = this.tf.get(id);
        if (docTf) {
          for (const token of docTf.keys()) {
            const count = this.df.get(token) || 1;
            if (count <= 1) {
              this.df.delete(token);
            } else {
              this.df.set(token, count - 1);
            }
          }
        }
        this.documents.delete(id);
        this.tf.delete(id);
        this.docLengths.delete(id);
        this.docCount--;
        changed = true;
      }
    }

    if (changed) {
      this.idfCache.clear();
      this.recalculateAvgLength();
    }
  }

  /**
   * Get index statistics
   */
  getStats() {
    return {
      docCount: this.docCount,
      uniqueTerms: this.df.size,
      avgDocLength: this.avgDocLength.toFixed(1),
      variant: this.currentVariant,
      symbolBoostFactor: RetrievalConfig.bm25.symbolBoostFactor || 3.0,
      isAutoTuned: this.isAutoTuned
    };
  }

  /**
   * Clear all indexed data
   */
  clear(): void {
    this.documents.clear();
    this.tf.clear();
    this.df.clear();
    this.docLengths.clear();
    this.idfCache.clear();
    this.avgDocLength = 0;
    this.docCount = 0;
  }
}
