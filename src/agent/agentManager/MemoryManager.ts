// =====================================================
// MemoryManager - Refactored Memory Management
// =====================================================

import {
  MemoryManager as BaseMemoryManager,
  Memory,
  MemorySearchResult
} from '../memory';
import { IAgentService } from './interfaces';

export class MemoryManager implements IAgentService {
  // Core memory component
  private baseMemoryManager: BaseMemoryManager;

  // Configuration
  private debug: boolean = false;

  constructor(baseMemoryManager: BaseMemoryManager) {
    this.baseMemoryManager = baseMemoryManager;
  }

  async initialize(): Promise<void> {
    try {
      await this.baseMemoryManager.initialize();

      if (this.debug) {
        console.log('[MemoryManager] Initialized successfully');
      }
    } catch (error) {
      console.error('[MemoryManager] Initialization failed:', error);
      throw error;
    }
  }

  dispose(): void {
    // Memory manager cleanup is handled by the base class
    if (this.debug) {
      console.log('[MemoryManager] Disposed successfully');
    }
  }

  // ==================== MEMORY OPERATIONS ====================

  /**
   * Add a new memory
   */
  async addMemory(
    content: string,
    source: 'manual' | 'automatic' | 'agent' = 'manual',
    category?: 'preference' | 'codebase' | 'workflow' | 'tech-stack' | 'general',
    scope?: any
  ): Promise<Memory> {
    return await this.baseMemoryManager.addMemory(content, source, category, scope);
  }

  /**
   * Get relevant memories for a context
   */
  async getRelevantMemories(context: string, maxCount: number = 5, memoryContext?: any): Promise<MemorySearchResult[]> {
    return await this.baseMemoryManager.getRelevantMemories(context, maxCount, memoryContext);
  }

  /**
   * Get all memories
   */
  getAllMemories(): Memory[] {
    return this.baseMemoryManager.getAllMemories();
  }

  /**
   * Get a specific memory by ID
   */
  getMemory(id: string): Memory | undefined {
    return this.baseMemoryManager.getMemory(id as any);
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    return await this.baseMemoryManager.deleteMemory(id as any);
  }

  /**
   * Update a memory
   */
  async updateMemory(id: string, content: string, category?: any): Promise<Memory | null> {
    return await this.baseMemoryManager.updateMemory(id as any, content, category);
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): any {
    return this.baseMemoryManager.getStats();
  }

  /**
   * Clear all memories
   */
  async clearAllMemories(): Promise<void> {
    return await this.baseMemoryManager.clearAll();
  }

  /**
   * Deprecate a memory
   */
  async deprecateMemory(id: string, reason?: string, supersededBy?: string): Promise<Memory | null> {
    return await this.baseMemoryManager.deprecateMemory(id as any, reason, supersededBy as any);
  }

  /**
   * Detect potential conflicts with existing memories
   */
  async detectConflicts(content: string, category?: any): Promise<any[]> {
    return await (this.baseMemoryManager as any).detectConflicts(content, category);
  }

  // ==================== MEMORY PROMPT UTILITIES ====================

  /**
   * Get memories formatted for prompt
   */
  async getMemoriesForPrompt(context: string = ''): Promise<string> {
    // Get ALL preferences and tech-stack (these are ALWAYS rules)
    const allMemories = this.getAllMemories();
    const alwaysMemories = allMemories.filter(m =>
      m.category === 'preference' || m.category === 'tech-stack'
    );

    // Get relevant memories for context (other categories)
    const contextMemories = context
      ? await this.getRelevantMemories(context, 10)
      : [];

    // Combine: Always memories + relevant context memories
    const combinedMemories = [
      ...alwaysMemories.map(m => ({ memory: m, score: 1, reason: 'Always rule' })),
      ...contextMemories.filter(r => {
        const mem = 'memory' in r ? r.memory : r;
        return mem.category !== 'preference' && mem.category !== 'tech-stack';
      })
    ];

    if (combinedMemories.length === 0) {
      return '';
    }

    // Format memories into prompt
    return this.formatMemoriesForPrompt(combinedMemories);
  }

  /**
   * Format memories for prompt
   */
  private formatMemoriesForPrompt(memories: any[]): string {
    let prompt = '\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
    prompt += ' 🚨 CRITICAL: MANDATORY RULES - NEVER IGNORE THESE\n';
    prompt += ' ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    // Add memories to prompt
    memories.forEach((result, index) => {
      const mem = 'memory' in result ? result.memory : result;
      prompt += `   ${index + 1}. ✓ ${mem.content}\n`;
    });

    prompt += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

    return prompt;
  }

  // ==================== MEMORY CATEGORIES ====================

  /**
   * Get memories by category
   */
  getMemoriesByCategory(category: string): Memory[] {
    return this.getAllMemories().filter(memory => memory.category === category);
  }

  /**
   * Get preferences
   */
  getPreferences(): Memory[] {
    return this.getMemoriesByCategory('preference');
  }

  /**
   * Get tech stack memories
   */
  getTechStackMemories(): Memory[] {
    return this.getMemoriesByCategory('tech-stack');
  }

  /**
   * Get codebase memories
   */
  getCodebaseMemories(): Memory[] {
    return this.getMemoriesByCategory('codebase');
  }

  /**
   * Get workflow memories
   */
  getWorkflowMemories(): Memory[] {
    return this.getMemoriesByCategory('workflow');
  }

  // ==================== MEMORY SEARCH AND ANALYSIS ====================

  /**
   * Search memories with advanced filtering
   */
  async searchMemories(
    query: string,
    filters?: {
      categories?: string[];
      sources?: string[];
      dateRange?: { from?: Date; to?: Date };
    },
    maxResults: number = 10
  ): Promise<MemorySearchResult[]> {
    // First get semantic search results
    const semanticResults = await this.getRelevantMemories(query, maxResults * 2);

    // Apply filters
    let filteredResults = semanticResults;

    if (filters) {
      filteredResults = semanticResults.filter(result => {
        const memory = 'memory' in result ? result.memory : result;

        // Category filter
        if (filters.categories && !filters.categories.includes(memory.category)) {
          return false;
        }

        // Source filter
        if (filters.sources && !filters.sources.includes(memory.metadata.source)) {
          return false;
        }

        // Date range filter
        if (filters.dateRange) {
          const memoryDate = new Date(memory.metadata.createdAt);
          if (filters.dateRange.from && memoryDate < filters.dateRange.from) {
            return false;
          }
          if (filters.dateRange.to && memoryDate > filters.dateRange.to) {
            return false;
          }
        }

        return true;
      });
    }

    return filteredResults.slice(0, maxResults);
  }

  /**
   * Get memory usage statistics
   */
  getMemoryUsageStats(): {
    total: number;
    byCategory: Record<string, number>;
    bySource: Record<string, number>;
    averageRelevance: number;
    recentCount: number; // Memories from last 7 days
  } {
    const memories = this.getAllMemories();
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);

    const byCategory: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    let totalRelevance = 0;
    let relevanceCount = 0;
    let recentCount = 0;

    memories.forEach(memory => {
      // Category stats
      byCategory[memory.category] = (byCategory[memory.category] || 0) + 1;

      // Source stats
      bySource[memory.metadata.source] = (bySource[memory.metadata.source] || 0) + 1;

      // Recent memories
      if (memory.metadata.createdAt > oneWeekAgo) {
        recentCount++;
      }
    });

    return {
      total: memories.length,
      byCategory,
      bySource,
      averageRelevance: relevanceCount > 0 ? totalRelevance / relevanceCount : 0,
      recentCount
    };
  }

  /**
   * Optimize memory storage (cleanup old/unused memories)
   */
  async optimizeMemoryStorage(options: {
    maxAgeDays?: number;
    maxTotalMemories?: number;
    preserveCategories?: string[];
  } = {}): Promise<{
    removedCount: number;
    preservedCount: number;
    totalBefore: number;
    totalAfter: number;
  }> {
    const {
      maxAgeDays = 90,
      maxTotalMemories = 1000,
      preserveCategories = ['preference', 'tech-stack']
    } = options;

    const memories = this.getAllMemories();
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    const beforeCount = memories.length;
    const toRemove: string[] = [];

    // Sort by creation date (oldest first)
    const sortedMemories = memories
      .sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);

    // Mark memories for removal
    sortedMemories.forEach(memory => {
      // Skip preserved categories
      if (preserveCategories.includes(memory.category)) {
        return;
      }

      // Remove old memories
      if (memory.metadata.createdAt < now - maxAgeMs) {
        toRemove.push(memory.id);
        return;
      }

      // Remove excess memories (keeping most recent)
      if (memories.length - toRemove.length > maxTotalMemories) {
        toRemove.push(memory.id);
      }
    });

    // Remove marked memories
    let removedCount = 0;
    for (const memoryId of toRemove) {
      try {
        await this.deleteMemory(memoryId);
        removedCount++;
      } catch (error) {
        if (this.debug) {
          console.warn(`[MemoryManager] Failed to remove memory ${memoryId}:`, error);
        }
      }
    }

    return {
      removedCount,
      preservedCount: beforeCount - removedCount,
      totalBefore: beforeCount,
      totalAfter: beforeCount - removedCount
    };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Enable/disable debug logging
   */
  setDebug(debug: boolean): void {
    this.debug = debug;
  }

  /**
   * Get base memory manager instance
   */
  getBaseMemoryManager(): BaseMemoryManager {
    return this.baseMemoryManager;
  }

  /**
   * Get memory manager statistics
   */
  getStats(): any {
    return this.baseMemoryManager.getStats();
  }

  /**
   * Check if memory manager is initialized
   */
  isInitialized(): boolean {
    // This is a simple check - in a real implementation, you might want to track initialization state
    return this.baseMemoryManager.getAllMemories().length >= 0;
  }
}