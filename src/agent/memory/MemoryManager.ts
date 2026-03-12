/**
 * Memory Manager for Gently
 * 
 * Hybrid Memory System with Vector Search
 * Inspired by Augment Code's Memories feature
 */

import * as vscode from 'vscode';
import {
  Memory,
  MemoryCategory,
  MemorySource,
  MemorySearchResult,
  MemoryStats,
  MemoryStatus,
  MemoryConflict,
  MemoryScope,
  MemoryContext,
  MemoryId,
  PatternId
} from './types';
import { EmbeddingProvider } from '../retrieval';
import { PatternRecognition } from './PatternRecognition';
import { PatternSuggestion, PatternStats } from './patternTypes';
import { ScopeManager } from './ScopeManager';
import { MemoryPersistence } from './MemoryPersistence';
import { MemoryVectorStore } from './MemoryVectorStore';
import { MemoryScopeFilter } from './MemoryScopeFilter';
import { MemoryConflictResolver } from './MemoryConflictResolver';
import { OpenRouterService } from '../../services/OpenRouterService';

export class MemoryManager {
  private memories: Map<MemoryId, Memory> = new Map();
  private persistence: MemoryPersistence;
  private vectorStore: MemoryVectorStore;
  private scopeFilter: MemoryScopeFilter;
  private conflictResolver: MemoryConflictResolver;
  private embeddingProvider: EmbeddingProvider;
  private patternRecognition: PatternRecognition;
  private scopeManager: ScopeManager;
  private openRouterService?: OpenRouterService;
  private workspaceRoot: string;
  private isInitialized: boolean = false;

  private scoringConfig = {
    vectorWeight: 0.6,
    keywordWeight: 0.3,
    recencyWeight: 0.1,
    minScore: 0.4
  };

  constructor(workspaceRoot: string, embeddingProvider: EmbeddingProvider, openRouterService?: OpenRouterService) {
    this.workspaceRoot = workspaceRoot;
    this.persistence = new MemoryPersistence(workspaceRoot);
    this.vectorStore = new MemoryVectorStore(workspaceRoot);
    this.scopeManager = new ScopeManager();
    this.scopeFilter = new MemoryScopeFilter(this.scopeManager);
    this.conflictResolver = new MemoryConflictResolver(openRouterService);
    this.embeddingProvider = embeddingProvider;
    this.patternRecognition = new PatternRecognition(workspaceRoot, openRouterService);
    this.openRouterService = openRouterService;
  }

  /**
   * Initialize memory system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('[MemoryManager] Initializing...');

    // Ensure directory exists
    await this.persistence.ensureDirectory();

    // Load existing memories
    try {
      const loadedMemories = await this.persistence.load();
      for (const memory of loadedMemories) {
        this.memories.set(memory.id, memory);
        // Re-index in vector store
        try {
          await this.vectorStore.add(memory);
        } catch (vectorError) {
          console.error(`[MemoryManager] Failed to index memory ${memory.id} in vector store:`, vectorError);
        }
      }
    } catch (loadError) {
      console.error('[MemoryManager] Failed to load memories from persistence:', loadError);
      // We continue anyway – better an empty memory system than a crashed agent
    }

    // Initialize pattern recognition
    await this.patternRecognition.initialize();

    this.isInitialized = true;
    console.log(`[MemoryManager] Initialized with ${this.memories.size} memories`);
  }

  /**
   * Add a new memory
   */
  async addMemory(
    content: string,
    source: MemorySource = 'manual',
    category?: MemoryCategory,
    scope?: MemoryScope
  ): Promise<Memory> {
    console.log(`[MemoryManager] Adding memory: "${content.substring(0, 50)}..."`);

    // 1. Validate scope
    if (scope) {
      const validation = this.scopeManager.validateScope(scope);
      if (!validation.valid) {
        throw new Error(`Invalid scope: ${validation.errors.join(', ')}`);
      }
    }

    // 2. Auto-detect category
    const detectedCategory = category || this.detectCategory(content);

    // 3. Check for conflicts
    const conflicts = await this.conflictResolver.detectConflicts(
      content,
      detectedCategory,
      this.getAllMemories().filter(m => m.status === 'active'),
      async (c1, c2) => {
        const e1 = await this.embeddingProvider.embed(c1);
        const e2 = await this.embeddingProvider.embed(c2);
        return this.cosineSimilarity(e1, e2);
      }
    );

    if (conflicts.length > 0 && conflicts[0].similarity > 0.95) {
      console.warn('[MemoryManager] High similarity conflict detected, skipping add');
      return conflicts[0].existingMemory;
    }

    // 4. Generate embedding
    const embedding = await this.embeddingProvider.embed(content);

    const memory: Memory = {
      id: this.generateMemoryId(),
      content,
      category: detectedCategory,
      embedding,
      status: 'active',
      confidence: 1.0,
      scope,
      lastUsed: Date.now(),
      usageCount: 0,
      metadata: {
        createdAt: Date.now(),
        lastUsed: Date.now(),
        useCount: 0,
        source,
        tags: this.extractTags(content),
        relevanceScore: 1.0
      }
    };

    // 5. Update state and persistence
    this.memories.set(memory.id, memory);
    await this.vectorStore.add(memory);
    await this.persistence.save(this.memories);

    console.log(`[MemoryManager] Memory added with ID: ${memory.id}, category: ${detectedCategory}`);
    return memory;
  }

  /**
   * Get relevant memories for a given context
   */
  async getRelevantMemories(
    context: string,
    maxCount: number = 5,
    memoryContext?: MemoryContext
  ): Promise<MemorySearchResult[]> {
    if (this.memories.size === 0) {
      return [];
    }

    // 1. Semantic Search
    const queryEmbedding = await this.embeddingProvider.embed(context);
    const vectorResults = await this.vectorStore.search(queryEmbedding, maxCount * 2);

    // 2. Keyword Search
    const keywordScores = this.keywordSearch(context);

    // 3. Hybrid Scoring & Filtering
    const results: MemorySearchResult[] = [];
    const now = Date.now();

    for (const vRes of vectorResults) {
      const memory = this.memories.get(vRes.id);
      if (!memory || memory.status !== 'active') continue;

      // Filter by scope
      if (memoryContext && memory.scope) {
        const scopeResult = this.scopeManager.matchesContext(memory.scope, memoryContext);
        if (!scopeResult.matches) continue;
      }

      const vectorScore = vRes.score;
      const keywordScore = keywordScores.get(memory.id) || 0;
      const recencyBonus = this.calculateRecencyBonus(memory.lastUsed || memory.metadata.lastUsed);

      // Normalize keyword score (simple cap/scale for now)
      const normalizedKeywordScore = Math.min(1.0, keywordScore / 3);

      const finalScore = (vectorScore * this.scoringConfig.vectorWeight) +
        (normalizedKeywordScore * this.scoringConfig.keywordWeight) +
        (recencyBonus * this.scoringConfig.recencyWeight);

      if (finalScore >= this.scoringConfig.minScore) {
        results.push({
          memory,
          score: finalScore * memory.confidence,
          reason: `Hybrid Score: ${finalScore.toFixed(2)} (V:${vectorScore.toFixed(2)}, K:${normalizedKeywordScore.toFixed(2)}, R:${recencyBonus.toFixed(2)})`
        });
      }
    }

    const finalResults = results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCount);

    // Update usage
    if (finalResults.length > 0) {
      for (const res of finalResults) {
        res.memory.lastUsed = now;
        res.memory.usageCount = (res.memory.usageCount || 0) + 1;
        res.memory.metadata.lastUsed = now;
        res.memory.metadata.useCount++;
      }
      await this.persistence.save(this.memories);
    }

    return finalResults;
  }

  /**
   * Get all memories
   */
  getAllMemories(): Memory[] {
    return Array.from(this.memories.values());
  }

  /**
   * Get memory by ID
   */
  getMemory(id: MemoryId): Memory | undefined {
    return this.memories.get(id);
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: MemoryId): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) {
      return false;
    }

    this.memories.delete(id);
    await this.vectorStore.remove(id);
    await this.persistence.save(this.memories);

    console.log(`[MemoryManager] Deleted memory: ${id}`);
    return true;
  }

  /**
   * Update a memory
   */
  async updateMemory(id: MemoryId, content: string, category?: MemoryCategory): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) {
      return null;
    }

    memory.content = content;
    if (category) {
      memory.category = category;
    }

    memory.embedding = await this.embeddingProvider.embed(content);
    memory.metadata.tags = this.extractTags(content);

    await this.vectorStore.remove(id);
    await this.vectorStore.add(memory);
    await this.persistence.save(this.memories);

    console.log(`[MemoryManager] Updated memory: ${id}`);
    return memory;
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const memories = Array.from(this.memories.values());

    const byCategory: Record<MemoryCategory, number> = {
      preference: 0,
      codebase: 0,
      workflow: 0,
      'tech-stack': 0,
      general: 0
    };

    const bySource: Record<MemorySource, number> = {
      manual: 0,
      automatic: 0,
      agent: 0
    };

    memories.forEach(m => {
      byCategory[m.category]++;
      bySource[m.metadata.source]++;
    });

    const byStatus: Record<MemoryStatus, number> = {
      active: 0,
      deprecated: 0,
      archived: 0
    };
    memories.forEach(m => byStatus[m.status]++);

    return {
      totalMemories: memories.length,
      byCategory,
      bySource,
      byStatus,
      mostUsed: memories.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5),
      recentlyAdded: memories.sort((a, b) => b.metadata.createdAt - a.metadata.createdAt).slice(0, 5),
      lowConfidence: memories.filter(m => m.confidence < 0.5 && m.status === 'active').slice(0, 5)
    };
  }

  /**
   * Deprecate a memory
   */
  async deprecateMemory(id: MemoryId, reason?: string, supersededBy?: MemoryId): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) {
      return null;
    }

    memory.status = 'deprecated';
    memory.deprecatedAt = Date.now();
    memory.deprecationReason = reason;
    memory.supersededBy = supersededBy;
    memory.confidence = 0;

    await this.persistence.save(this.memories);
    return memory;
  }

  /**
   * Restore a memory
   */
  async restoreMemory(id: MemoryId): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) {
      return null;
    }

    memory.status = 'active';
    memory.confidence = 0.8;
    memory.deprecatedAt = undefined;

    await this.persistence.save(this.memories);
    return memory;
  }

  /**
   * Decrease confidence of a memory
   */
  async decreaseConfidence(id: MemoryId, amount: number = 0.2): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) {
      return null;
    }

    memory.confidence = Math.max(0, memory.confidence - amount);
    if (memory.confidence < 0.3 && memory.status === 'active') {
      await this.deprecateMemory(id, 'Automatically deprecated due to low confidence');
    }

    await this.persistence.save(this.memories);
    return memory;
  }

  /**
   * Clear all memories
   */
  async clearAll(): Promise<void> {
    this.memories.clear();
    await this.vectorStore.clear();
    await this.persistence.clear();
  }

  // ==================== PATTERN RECOGNITION METHODS ====================

  async recordCorrection(context: string, original: string, corrected: string, fileType?: string, filePath?: string): Promise<void> {
    await this.patternRecognition.recordCorrection(context, original, corrected, fileType, filePath);
  }

  getReadyPatterns(): PatternSuggestion[] {
    const patterns = this.patternRecognition.getReadyPatterns();
    return patterns.map(p => this.patternRecognition.generateSuggestion(p));
  }

  async acceptPatternSuggestion(patternId: PatternId, memoryContent: string, category?: MemoryCategory): Promise<Memory> {
    const memory = await this.addMemory(memoryContent, 'automatic', category);
    await this.patternRecognition.markAsAccepted(patternId, memory.id);
    memory.confidence = Math.min(1.0, memory.confidence + 0.1);
    await this.persistence.save(this.memories);
    return memory;
  }

  async rejectPatternSuggestion(patternId: PatternId): Promise<void> {
    await this.patternRecognition.markAsRejected(patternId);
  }

  getPatternStats(): PatternStats {
    return this.patternRecognition.getStats();
  }

  async clearPatterns(): Promise<void> {
    await this.patternRecognition.clearAll();
  }

  // ==================== SCOPE METHODS ====================

  createContextFromPath(filePath: string): MemoryContext {
    return this.scopeManager.createContext(filePath);
  }

  validateScope(scope: MemoryScope) {
    return this.scopeManager.validateScope(scope);
  }

  getMemoriesForScope(scope: MemoryScope): Memory[] {
    return Array.from(this.memories.values()).filter(m => JSON.stringify(m.scope) === JSON.stringify(scope));
  }

  getScopedMemories(): Memory[] {
    return Array.from(this.memories.values()).filter(m => m.scope !== undefined);
  }

  getGlobalMemories(): Memory[] {
    return Array.from(this.memories.values()).filter(m => m.scope === undefined);
  }

  async updateMemoryScope(id: MemoryId, scope?: MemoryScope): Promise<Memory | null> {
    const memory = this.memories.get(id);
    if (!memory) return null;
    if (scope) {
      const v = this.scopeManager.validateScope(scope);
      if (!v.valid) throw new Error(v.errors.join(', '));
    }
    memory.scope = scope;
    await this.persistence.save(this.memories);
    return memory;
  }

  // ==================== PRIVATE UTILITIES ====================

  private detectCategory(content: string): MemoryCategory {
    const contentLower = content.toLowerCase();
    const keywords: Record<MemoryCategory, string[]> = {
      'preference': ['prefer', 'like', 'always', 'never', 'style', 'convention'],
      'codebase': ['architecture', 'structure', 'pattern', 'design', 'module'],
      'workflow': ['process', 'workflow', 'steps', 'procedure', 'deploy'],
      'tech-stack': ['use', 'framework', 'library', 'technology', 'tool'],
      'general': []
    };

    for (const [category, words] of Object.entries(keywords)) {
      if (category === 'general') continue;
      if (words.some(word => contentLower.includes(word))) return category as MemoryCategory;
    }
    return 'general';
  }

  private extractTags(content: string): string[] {
    const terms = ['typescript', 'javascript', 'python', 'react', 'node', 'api', 'test'];
    const contentLower = content.toLowerCase();
    return terms.filter(term => contentLower.includes(term));
  }

  private keywordSearch(query: string): Map<MemoryId, number> {
    const scores = new Map<MemoryId, number>();
    const queryWords = query.toLowerCase().split(/\s+/);

    for (const [id, memory] of this.memories) {
      let score = 0;
      const contentLower = memory.content.toLowerCase();
      queryWords.forEach(word => {
        if (word.length > 2 && contentLower.includes(word)) score += 1;
      });
      if (score > 0) scores.set(id, score);
    }
    return scores;
  }

  private generateMemoryId(): MemoryId {
    return `mem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as MemoryId;
  }

  private cosineSimilarity(v1: number[], v2: number[]): number {
    let dotProduct = 0, norm1 = 0, norm2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dotProduct += v1[i] * v2[i];
      norm1 += v1[i] * v1[i];
      norm2 += v2[i] * v2[i];
    }
    const den = Math.sqrt(norm1) * Math.sqrt(norm2);
    return den === 0 ? 0 : dotProduct / den;
  }

  private calculateRecencyBonus(lastUsed: number): number {
    const now = Date.now();
    const ageInHours = (now - lastUsed) / (1000 * 60 * 60);

    if (ageInHours <= 1) return 1.0;
    if (ageInHours <= 24) return 0.8;
    if (ageInHours <= 24 * 7) return 0.5;
    return 0.2;
  }
}
