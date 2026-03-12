/**
 * Context Manager for Smart Context Management
 * 
 * This module provides intelligent context tracking:
 * - Automatic file relevance scoring
 * - Token usage tracking
 * - Context window optimization
 * - Manual pin/unpin support
 */

import * as vscode from 'vscode';

export interface ContextFile {
  path: string;
  score: number;           // Relevance score (0-100)
  lastUsed: number;        // Timestamp of last access
  usageCount: number;      // Number of times accessed
  tokenCount: number;      // Estimated token count
  inContext: boolean;      // Currently in context?
  pinned: boolean;         // Manually pinned by user?
  language: string;        // File language
  size: number;            // File size in bytes
}

export interface ContextStats {
  totalFiles: number;
  filesInContext: number;
  totalTokens: number;
  maxTokens: number;
  utilizationPercent: number;
}

/**
 * Context Manager - Smart context tracking and optimization
 */
export class ContextManager {
  private files: Map<string, ContextFile> = new Map();
  private maxTokens: number = 8000; // Default context window
  private readonly SCORE_WEIGHTS = {
    USAGE_COUNT: 30,
    RECENCY: 40,
    PINNED: 100,
  };

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
  }

  /**
   * Track file access (read/write/edit)
   */
  trackFileAccess(filePath: string, content: string, language: string, size: number): void {
    const now = Date.now();
    const tokenCount = this.estimateTokenCount(content);

    if (this.files.has(filePath)) {
      // Update existing file
      const file = this.files.get(filePath)!;
      file.lastUsed = now;
      file.usageCount++;
      file.tokenCount = tokenCount;
      file.language = language;
      file.size = size;
      file.score = this.calculateScore(file);
    } else {
      // Add new file
      const file: ContextFile = {
        path: filePath,
        score: 0,
        lastUsed: now,
        usageCount: 1,
        tokenCount,
        inContext: false,
        pinned: false,
        language,
        size,
      };
      file.score = this.calculateScore(file);
      this.files.set(filePath, file);
    }

    // Optimize context after tracking
    this.optimizeContext();
  }

  /**
   * Calculate relevance score for a file
   */
  private calculateScore(file: ContextFile): number {
    if (file.pinned) {
      return this.SCORE_WEIGHTS.PINNED;
    }

    const now = Date.now();
    const ageInMinutes = (now - file.lastUsed) / (1000 * 60);

    // Recency score (decays over time)
    // 100% if < 5 min, 50% if < 30 min, 0% if > 60 min
    let recencyScore = 0;
    if (ageInMinutes < 5) {
      recencyScore = 100;
    } else if (ageInMinutes < 30) {
      recencyScore = 100 - ((ageInMinutes - 5) / 25) * 50;
    } else if (ageInMinutes < 60) {
      recencyScore = 50 - ((ageInMinutes - 30) / 30) * 50;
    }

    // Usage count score (logarithmic scale)
    // 1 use = 0%, 5 uses = 50%, 10+ uses = 100%
    const usageScore = Math.min(100, (Math.log(file.usageCount + 1) / Math.log(11)) * 100);

    // Weighted average
    const score =
      (usageScore * this.SCORE_WEIGHTS.USAGE_COUNT / 100) +
      (recencyScore * this.SCORE_WEIGHTS.RECENCY / 100);

    return Math.round(score);
  }

  /**
   * Optimize context - keep most relevant files within token limit
   */
  private optimizeContext(): void {
    // Recalculate all scores
    for (const file of this.files.values()) {
      file.score = this.calculateScore(file);
    }

    // Sort files by score (descending)
    const sortedFiles = Array.from(this.files.values()).sort((a, b) => b.score - a.score);

    let currentTokens = 0;

    // Mark files as in/out of context
    for (const file of sortedFiles) {
      if (file.pinned || currentTokens + file.tokenCount <= this.maxTokens) {
        file.inContext = true;
        currentTokens += file.tokenCount;
      } else {
        file.inContext = false;
      }
    }

    console.log(`[ContextManager] Optimized context: ${currentTokens}/${this.maxTokens} tokens`);
  }

  /**
   * Estimate token count for content
   * Bessere Schätzung (basierend auf OpenAI tiktoken-ähnlich)
   */
  private estimateTokenCount(content: string): number {
    const words = content.split(/\s+/).length;
    const lines = content.split('\n').length;
    return Math.ceil(words * 1.35 + lines * 2);
  }

  /**
   * Pin a file (keep in context)
   */
  pinFile(filePath: string): void {
    const file = this.files.get(filePath);
    if (file) {
      file.pinned = true;
      file.score = this.SCORE_WEIGHTS.PINNED;
      this.optimizeContext();
    }
  }

  /**
   * Unpin a file
   */
  unpinFile(filePath: string): void {
    const file = this.files.get(filePath);
    if (file) {
      file.pinned = false;
      file.score = this.calculateScore(file);
      this.optimizeContext();
    }
  }

  /**
   * Get all tracked files
   */
  getAllFiles(): ContextFile[] {
    return Array.from(this.files.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Get files currently in context
   */
  getFilesInContext(): ContextFile[] {
    return Array.from(this.files.values())
      .filter(f => f.inContext)
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Get context statistics
   */
  getStats(): ContextStats {
    const allFiles = Array.from(this.files.values());
    const filesInContext = allFiles.filter(f => f.inContext);
    const totalTokens = filesInContext.reduce((sum, f) => sum + f.tokenCount, 0);

    return {
      totalFiles: allFiles.length,
      filesInContext: filesInContext.length,
      totalTokens,
      maxTokens: this.maxTokens,
      utilizationPercent: Math.round((totalTokens / this.maxTokens) * 100),
    };
  }

  /**
   * Clear all tracked files
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * Remove a file from tracking
   */
  removeFile(filePath: string): void {
    this.files.delete(filePath);
    this.optimizeContext();
  }

  /**
   * Set max tokens
   */
  setMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
    this.optimizeContext();
  }

  /**
   * Get file info
   */
  getFile(filePath: string): ContextFile | undefined {
    return this.files.get(filePath);
  }

  /**
   * Restore context state from saved session payload
   */
  hydrateContext(files: ContextFile[] | null, stats: ContextStats | null): void {
    this.files.clear();
    if (files && Array.isArray(files)) {
      for (const file of files) {
        this.files.set(file.path, file);
      }
    }
    if (stats && stats.maxTokens) {
      this.maxTokens = stats.maxTokens;
    }
    // We do not call optimizeContext() here because we want to restore exact saved state
  }
}

