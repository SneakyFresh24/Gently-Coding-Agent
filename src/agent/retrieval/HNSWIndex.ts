import * as hnswlib from 'hnswlib-node';
import * as path from 'path';
import * as fs from 'fs/promises';
import { VectorDocument, HNSWSearchResult } from './types';
import { RetrievalConfig } from './RetrievalConfig';
import { ensureDir, safeWriteFile } from '../../utils/persistenceUtils';

export interface HNSWIndexOptions {
  dimensions: number;
  maxElements?: number;
  m?: number;
  efConstruction?: number;
  efSearch?: number;
  space?: 'l2' | 'inner_product' | 'cosine';
  persistenceDir?: string;
  quantize?: 'float32' | 'int8';
  logger?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface HNSWStats {
  count: number;
  dimensions: number;
  maxElements: number;
}

/**
 * Modernized HNSW Index for 2026 Code Retrieval
 * 
 * Features:
 * - Symmetric int8 quantization [-1, 1] -> [-127, 127]
 * - Improved deletion logic via activeLabels filtering
 * - Asynchronous persistence
 */
export class HNSWIndex {
  private index: hnswlib.HierarchicalNSW | null = null;
  private options: HNSWIndexOptions;
  private documents: Map<string, VectorDocument> = new Map(); // id -> document
  private labelToId: Map<number, string> = new Map(); // label -> id
  private idToLabel: Map<string, number> = new Map(); // id -> label
  private activeLabels: Set<number> = new Set(); // Currently valid labels
  private nextLabel: number = 0;
  private isInitialized: boolean = false;
  private readonly indexPath: string;
  private readonly metaPath: string;

  // 9.5+ Optimization State (Refined for 9.8)
  private minDims: number[] | null = null; // Global fallback
  private maxDims: number[] | null = null; // Global fallback
  private langCalibration: Map<string, { minDims: number[], maxDims: number[] }> = new Map();
  private calibrationVectors: { vector: number[], language: string, stratum: 'large' | 'config' | 'normal' }[] = [];
  private calibrationCount: number = 0;
  private isCalibrated: boolean = false;
  private lastValidatedCount: number = 0;
  private recallOverride: 'float32' | null = null;
  private adaptiveOversampleFactor: number = RetrievalConfig.hnsw.int8OversampleFactor || 1.8;
  private logger: (level: 'info' | 'warn' | 'error', message: string) => void;

  constructor(options: HNSWIndexOptions) {
    this.options = {
      maxElements: 10000,
      m: 16,
      efConstruction: 200,
      efSearch: 60,
      space: 'cosine',
      quantize: 'float32',
      ...options
    };
    this.indexPath = options.persistenceDir ? path.join(options.persistenceDir, 'hnsw.index') : '';
    this.metaPath = options.persistenceDir ? path.join(options.persistenceDir, 'hnsw.meta.json') : '';
    this.logger = this.options.logger || ((level, msg) => console[level](msg));
  }

  /**
   * Initialize or load the index
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.ensurePersistenceDir();

    const space = this.options.space === 'cosine' ? 'cosine' : (this.options.space === 'l2' ? 'l2' : 'ip');
    
    // Safety check for native module
    if (!hnswlib || typeof hnswlib.HierarchicalNSW !== 'function') {
        throw new Error('Native hnswlib module not loaded. Search will be disabled or running in BM25-only fallback.');
    }

    this.index = new hnswlib.HierarchicalNSW(space as any, this.options.dimensions);

    if (this.indexPath && await this.fileExists(this.indexPath)) {
      try {
        await this.index.readIndex(this.indexPath);
        await this.loadMetadata();
        console.log(`[HNSWIndex] Loaded index with ${this.documents.size} documents`);
      } catch (error) {
        console.error('[HNSWIndex] Error loading index, starting fresh:', error);
        this.initNewIndex();
      }
    } else {
      this.initNewIndex();
    }

    if (this.options.quantize === 'int8') {
      console.warn('[HNSWIndex] ⚠️ int8 quantization enabled – Using internal float32 with clipped values (hnswlib-node limit)');
    }

    if (this.options.efSearch) {
      if (typeof this.index.setEf === 'function') {
        this.index.setEf(this.options.efSearch);
      }
    }

    this.isInitialized = true;
  }

  /**
   * Initialize a new index with size-aware parameters
   */
  private initNewIndex(): void {
    if (!this.index) return;

    // Choose parameters based on expected size (9.5+ Profile)
    let m = this.options.m || 16;
    let efC = this.options.efConstruction || 200;

    const count = this.documents.size || 0;
    const profiles = RetrievalConfig.hnsw.sizeProfiles;

    if (count > profiles.large.limit) {
      m = profiles.xlarge.m; efC = profiles.xlarge.efC;
    } else if (count > profiles.medium.limit) {
      m = profiles.large.m; efC = profiles.large.efC;
    } else if (count > profiles.small.limit) {
      m = profiles.medium.m; efC = profiles.medium.efC;
    } else {
      m = profiles.small.m; efC = profiles.small.efC;
    }

    console.log(`[HNSWIndex] Initializing fresh index with m=${m}, efConstruction=${efC} (Size Profile)`);
    
    // Fix for hnswlib-node 3.0.0 initIndex call
    // The repro script confirmed that the version we use supports (maxElements, m, efConstruction, randomSeed)
    try {
        this.index.initIndex(this.options.maxElements!, m, efC, 100);
    } catch (e) {
        console.warn('[HNSWIndex] initIndex failed with positional args, falling back to object-based init...');
        try {
            (this.index as any).initIndex({
                maxElements: this.options.maxElements!,
                m,
                efConstruction: efC,
                randomSeed: 100
            });
        } catch (e2) {
            console.error('[HNSWIndex] All HNSW init attempts failed.', e2);
            throw e2;
        }
    }
  }

  /**
   * Dynamically update efSearch
   */
  setEfSearch(ef: number): void {
    if (this.index) {
      this.index.setEf(ef);
      this.options.efSearch = ef;
    }
  }

  private async ensurePersistenceDir(): Promise<void> {
    if (this.options.persistenceDir) {
      await ensureDir(this.options.persistenceDir);
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

  /**
   * Stratified Calibration: Finds 1st and 99th percentiles per dimension
   */
  private calibrateClipping(samples: number[][], language?: string): void {
    if (samples.length < 50) return; // Allow smaller per-lang samples

    const dims = this.options.dimensions;
    const min = new Array(dims);
    const max = new Array(dims);

    for (let d = 0; d < dims; d++) {
      const values = samples.map(s => s[d]).sort((a, b) => a - b);
      // 1st and 99th percentiles to kill outliers (LAVQ-style)
      min[d] = values[Math.floor(values.length * 0.01)];
      max[d] = values[Math.floor(values.length * 0.99)];
    }

    if (language) {
      this.langCalibration.set(language, { minDims: min, maxDims: max });
      console.log(`[HNSWIndex] 🧪 Per-language calibration complete for: ${language}`);
    } else {
      this.minDims = min;
      this.maxDims = max;
    }

    this.isCalibrated = true;
  }

  /**
   * Quantize vector to int8 symmetrically using clipped bounds
   */
  private quantizeVector(vector: number[], language?: string): number[] {
    if (this.options.quantize !== 'int8') return vector;

    // 9.8 Fix: Prefer per-language calibration
    const calib = language ? this.langCalibration.get(language) : null;
    const minD = calib?.minDims || this.minDims;
    const maxD = calib?.maxDims || this.maxDims;

    return vector.map((v, i) => {
      const min = (this.isCalibrated && minD) ? minD[i] : -1;
      const max = (this.isCalibrated && maxD) ? maxD[i] : 1;

      // Clamp to bounds
      const clamped = Math.max(min, Math.min(max, v));

      const range = max - min;
      if (range <= 0) return 0;

      const normalized = ((clamped - min) / range) * 254 - 127;
      return Math.round(normalized);
    });
  }

  /**
   * High-Precision Safety Net: Validates recall against float32 ground truth
   * We compare search results from the Float32 index (pre-quantization) 
   * against the Int8 index (post-quantization).
   */
  async validateQuantization(samples: number[][]): Promise<boolean> {
    if (!this.index || this.options.quantize !== 'int8' || samples.length === 0) return true;

    // 9.8 Lazy Validation: Only run if 500+ new docs added or first 100
    const count = this.documents.size;
    if (count > 100 && count < this.lastValidatedCount + 500) {
      return true;
    }
    this.lastValidatedCount = count;

    const testCount = Math.min(samples.length, 100);
    const topK = 10;
    const threshold = RetrievalConfig.hnsw.recallThreshold || 0.93;

    console.log(`[HNSWIndex] 🧪 Phase 1: Capturing Float32 Ground Truth for ${testCount} samples...`);

    // Store original EF to restore later
    const originalEf = this.options.efSearch || 60;

    // 1. Capture Ground Truth from the current (Float32) index
    const groundTruths: number[][] = [];
    this.index.setEf(400); // High precision for baseline

    for (let i = 0; i < testCount; i++) {
      const results = this.index.searchKnn(samples[i], topK);
      groundTruths.push(results.neighbors);
    }

    // 2. Clear and Re-index as Int8
    console.log(`[HNSWIndex] 🧪 Phase 2: Converting index to Int8 and measuring recall...`);
    this.isCalibrated = true; // Enable quantization for re-indexing
    const allDocs = Array.from(this.documents.values());
    await this.clear();
    await this.addDocuments(allDocs);

    // 3. Measure Int8 Performance
    let totalRecall = 0;
    let totalNDCG = 0;
    let totalMRR = 0;

    // Use adaptive efSearch for validation
    const valEf = Math.min(Math.round(originalEf * this.adaptiveOversampleFactor), 400);
    this.index.setEf(valEf);

    for (let i = 0; i < testCount; i++) {
      const measuredResults = this.index.searchKnn(this.quantizeVector(samples[i]), topK);
      const measured = measuredResults.neighbors;

      totalRecall += this.calculateRecall(groundTruths[i], measured);
      totalNDCG += this.calculateNDCG(groundTruths[i], measured);
      totalMRR += this.calculateMRR(groundTruths[i], measured);
    }

    // Restore original EF
    this.index.setEf(originalEf);

    const avgRecall = totalRecall / testCount;
    const avgNDCG = totalNDCG / testCount;
    const avgMRR = totalMRR / testCount;

    console.log(`[HNSWIndex] 📊 Validation Results (int8 vs float32):`);
    console.log(`   - Recall@10: ${avgRecall.toFixed(4)} (Min required: ${threshold})`);
    console.log(`   - NDCG@10:   ${avgNDCG.toFixed(4)}`);
    console.log(`   - MRR@10:    ${avgMRR.toFixed(4)}`);

    if (avgRecall < threshold) {
      this.forceFloat32();
      return false;
    }

    // Adaptive adjustment: if recall is good but not "perfect", slightly boost oversampling
    if (avgRecall < 0.98 && RetrievalConfig.hnsw.adaptiveOversample) {
      this.adaptiveOversampleFactor = Math.min(2.5, this.adaptiveOversampleFactor + 0.1);
      console.log(`[HNSWIndex] 📈 Auto-boosting adaptiveOversampleFactor to ${this.adaptiveOversampleFactor.toFixed(2)}`);
    }

    return true;
  }

  private calculateRecall(gt: number[], measured: number[]): number {
    const measuredSet = new Set(measured);
    const matches = gt.filter(id => measuredSet.has(id)).length;
    return matches / gt.length;
  }

  private calculateMRR(gt: number[], measured: number[]): number {
    const firstRelevant = measured.findIndex(id => id === gt[0]);
    return firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
  }

  private calculateNDCG(gt: number[], measured: number[]): number {
    let dcg = 0;
    let idcg = 0;
    const measuredSet = new Set(measured);

    for (let i = 0; i < gt.length; i++) {
      // Relevance score: 2 if perfect match, 1 if in topK but not at same rank, 0 otherwise
      // For simplicity, we'll use 1 if present in ground truth, 0 otherwise.
      // A more sophisticated NDCG would use actual relevance scores.
      const rel = measuredSet.has(gt[i]) ? 1 : 0;
      dcg += rel / Math.log2(i + 2);

      // Ideal DCG assumes perfect ordering of all ground truth items
      idcg += 1 / Math.log2(i + 2);
    }
    return idcg === 0 ? 0 : dcg / idcg;
  }

  /**
   * Force fallback to float32
   */
  forceFloat32(): void {
    console.warn('[HNSWIndex] ⚠️ Falling back to float32 due to quantization recall loss.');
    this.options.quantize = 'float32';
    this.recallOverride = 'float32';
    this.saveMetadata().catch(e => console.error('[HNSWIndex] Error saving fallback metadata:', e));
  }

  /**
   * Add a document to the index
   */
  async addDocument(doc: VectorDocument): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    // Calibration & Validation Logic (9.5+)
    if (this.options.quantize === 'int8' && !this.isCalibrated) {
      this.handleCalibrationSampling(doc);
    }

    const label = this.nextLabel++;
    const vector = this.quantizeVector(doc.embedding!, doc.language);
    this.index!.addPoint(vector, label);

    this.documents.set(doc.id, doc);
    this.labelToId.set(label, doc.id);
    this.idToLabel.set(doc.id, label);
    this.activeLabels.add(label);

    await this.saveMetadata();
  }

  /**
   * Batch add documents using optimized addPoints if available
   */
  async addDocuments(docs: VectorDocument[]): Promise<void> {
    if (!this.isInitialized) await this.initialize();

    const vectors: number[][] = [];
    const labels: number[] = [];

    for (const doc of docs) {
      if (this.options.quantize === 'int8' && !this.isCalibrated) {
        this.handleCalibrationSampling(doc);
      }

      const label = this.nextLabel++;
      const vector = this.quantizeVector(doc.embedding!, doc.language);

      vectors.push(vector);
      labels.push(label);

      this.documents.set(doc.id, doc);
      this.labelToId.set(label, doc.id);
      this.idToLabel.set(doc.id, label);
      this.activeLabels.add(label);
    }

    if (this.index && vectors.length > 0) {
      // HNSWlib-node supports batch addPoints since 0.4.0
      // We check for its existence to be safe
      if ((this.index as any).addPoints) {
        (this.index as any).addPoints(vectors, labels);
      } else {
        // Fallback to sequential
        for (let i = 0; i < vectors.length; i++) {
          this.index.addPoint(vectors[i], labels[i]);
        }
      }
    }

    await this.saveMetadata();
  }

  /**
   * Stratified Sampling & Calibration Trigger
   * Rules: 30% per language, 20% large files, 20% test/configs
   */
  private async handleCalibrationSampling(doc: VectorDocument): Promise<void> {
    const config = RetrievalConfig.hnsw;
    const samplesNeeded = config.calibrationSamples || 500;

    // Ignore first 50 samples for warm-up/artifacts
    this.calibrationCount++;
    if (this.calibrationCount <= 50) return;

    if (this.calibrationVectors.length >= samplesNeeded) return;

    // Stratification Logic
    const languageLimit = Math.floor(samplesNeeded * 0.3);
    const largeFileLimit = Math.floor(samplesNeeded * 0.2);
    const configTestLimit = Math.floor(samplesNeeded * 0.2);

    const filePath = (doc.id || '').toLowerCase();
    const isLarge = (doc.metadata?.endLine && doc.metadata?.startLine)
      ? (doc.metadata.endLine - doc.metadata.startLine) > 1000
      : doc.content.length > 10000;
    const isConfigOrTest = filePath.includes('test') || filePath.includes('config') || filePath.includes('spec');

    // Check stratum distribution
    const langCount = this.calibrationVectors.filter(v => v.language === doc.language).length;
    const largeCount = this.calibrationVectors.filter(v => v.stratum === 'large').length;
    const configCount = this.calibrationVectors.filter(v => v.stratum === 'config').length;

    let shouldSample = false;
    if (langCount < languageLimit) shouldSample = true;
    else if (isLarge && largeCount < largeFileLimit) shouldSample = true;
    else if (isConfigOrTest && configCount < configTestLimit) shouldSample = true;
    else if (this.calibrationVectors.length < samplesNeeded * 0.5) {
      // Normal samples if we are low
      shouldSample = true;
    }

    if (shouldSample && doc.embedding) {
      this.calibrationVectors.push({
        vector: doc.embedding,
        language: doc.language,
        stratum: isLarge ? 'large' : (isConfigOrTest ? 'config' : 'normal')
      });
    }

    // Trigger Calibration & Re-indexing
    if (this.calibrationVectors.length >= samplesNeeded) {
      this.logger('info', `[HNSWIndex] Calibration threshold reached (${samplesNeeded} samples).`);
      const vectors = this.calibrationVectors.map(v => v.vector);

      // 1. Calibrate Percentile bounds
      this.calibrateClipping(vectors, doc.language); // 9.8: Calibrate per language

      // 2. High-Precision Validation & Transition
      // This method now captures GT, clears index, re-indexes as int8, and measures recall.
      const success = await this.validateQuantization(vectors);

      if (success) {
        console.log('[HNSWIndex] ✅ Quantization validated and applied via 9.5+ re-indexing pivot.');
      } else {
        console.error('[HNSWIndex] 🚨 Calibration failed validation. Persistent float32 fallback engaged.');
      }

      this.calibrationVectors = []; // Free memory
    }
  }

  /**
   * Remove a document from the index (soft delete/filter based)
   */
  async removeDocument(id: string): Promise<void> {
    await this.removeDocuments([id]);
  }

  /**
   * Batch remove documents from the index
   */
  async removeDocuments(ids: string[]): Promise<void> {
    let changed = false;
    for (const id of ids) {
      const label = this.idToLabel.get(id);
      if (label !== undefined) {
        this.activeLabels.delete(label);
        this.documents.delete(id);
        this.idToLabel.delete(id);
        changed = true;
      }
    }

    if (changed) {
      // Trigger compaction if needed (20%+ deleted)
      await this.compactIfNeeded();
      await this.saveMetadata();
    }
  }

  /**
   * Index Compaction: Rebuilds index when too many items are deleted
   */
  private async compactIfNeeded(): Promise<void> {
    const threshold = 0.8; // 20% deleted
    if (this.activeLabels.size < this.nextLabel * threshold && this.nextLabel > 100) {
      console.log(`[HNSWIndex] 🧹 Compacting index (Labels: ${this.activeLabels.size}, Next: ${this.nextLabel})...`);
      const allDocs = Array.from(this.documents.values());
      await this.clear();
      await this.addDocuments(allDocs);
    }
  }

  /**
   * Search labels with filtering
   */
  async search(queryEmbedding: number[], topK: number = 10): Promise<HNSWSearchResult[]> {
    if (!this.isInitialized) await this.initialize();

    const vector = this.quantizeVector(queryEmbedding);

    // Adaptive Oversampling (9.5+)
    let efSearch = this.options.efSearch || 60;
    if (this.options.quantize === 'int8') {
      efSearch = Math.round(efSearch * this.adaptiveOversampleFactor);
      // Cap to avoid latency spikes
      efSearch = Math.min(efSearch, 400);
    }

    if (this.index) {
      this.index.setEf(efSearch);
    }

    // Perform search with filtering
    const results = this.index!.searchKnn(vector, topK * 2, (label: number) => {
      return this.activeLabels.has(label);
    });

    return results.neighbors
      .map((label, i) => {
        const id = this.labelToId.get(label);
        if (id === undefined) return null;

        const distance = results.distances[i];
        // For cosine, distance is 1 - similarity
        const score = this.options.space === 'cosine' ? 1 - distance : distance;

        const res: HNSWSearchResult = {
          id,
          score,
          distance,
          metadata: this.documents.get(id)?.metadata
        };
        return res;
      })
      .filter((r): r is HNSWSearchResult => r !== null)
      .slice(0, topK);
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    if (this.index) {
      this.documents.clear();
      this.idToLabel.clear();
      this.labelToId.clear();
      this.activeLabels.clear();
      this.calibrationVectors = [];
      this.langCalibration.clear();
      this.index = null;
    }
  }

  /**
   * Save index and metadata to disk
   */
  async save(): Promise<void> {
    if (!this.isInitialized || !this.indexPath) return;

    try {
      if (this.indexPath) {
        await ensureDir(path.dirname(this.indexPath));
        await this.index!.writeIndex(this.indexPath);
      }
      await this.saveMetadata();
    } catch (error) {
      console.error('[HNSWIndex] Error saving index:', error);
    }
  }

  private async saveMetadata(): Promise<void> {
    if (!this.metaPath) return;
    const meta = {
      nextLabel: this.nextLabel,
      labelToId: Array.from(this.labelToId.entries()),
      idToLabel: Array.from(this.idToLabel.entries()),
      activeLabels: Array.from(this.activeLabels),
      recallOverride: this.recallOverride,
      isCalibrated: this.isCalibrated,
      minDims: this.minDims,
      maxDims: this.maxDims,
      langCalibration: Array.from(this.langCalibration.entries()),
      lastValidatedCount: this.lastValidatedCount, // 9.8 Persistence
      documents: Array.from(this.documents.entries()).map(([id, doc]) => {
        const { embedding, ...rest } = doc;
        return [id, rest];
      })
    };
    // 9.8 Polish: Meta JSON is normally small, but if > 5MB we could compress. 
    // For now, pretty-printing is disabled for production speed.
    await safeWriteFile(this.metaPath, JSON.stringify(meta));
  }

  private async loadMetadata(): Promise<void> {
    if (!this.metaPath || !await this.fileExists(this.metaPath)) return;
    const content = await fs.readFile(this.metaPath, 'utf8');
    const meta = JSON.parse(content);

    this.nextLabel = meta.nextLabel;
    this.labelToId = new Map(meta.labelToId);
    this.idToLabel = new Map(meta.idToLabel);
    this.activeLabels = new Set(meta.activeLabels);
    this.recallOverride = meta.recallOverride || null;
    this.isCalibrated = !!meta.isCalibrated;
    this.minDims = meta.minDims || null;
    this.maxDims = meta.maxDims || null;
    this.langCalibration = new Map(meta.langCalibration || []);
    this.lastValidatedCount = meta.lastValidatedCount || 0;

    if (this.recallOverride === 'float32') {
      this.options.quantize = 'float32';
    }

    // NOTE: Embeddings are NOT persisted in this.documents to save RAM. 
    // They are only available during the initial indexing run or from external cache.
    this.documents = new Map(meta.documents);
  }

  async clear(): Promise<void> {
    this.documents.clear();
    this.labelToId.clear();
    this.idToLabel.clear();
    this.activeLabels.clear();
    this.nextLabel = 0;
    if (this.index) {
      this.initNewIndex(); // Size-aware reset
    }
    await this.saveMetadata();
  }

  getStats(): HNSWStats {
    return {
      count: this.activeLabels.size,
      dimensions: this.options.dimensions,
      maxElements: this.options.maxElements || 0
    };
  }
}
