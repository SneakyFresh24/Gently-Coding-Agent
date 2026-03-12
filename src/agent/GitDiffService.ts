/**
 * Git Diff Service
 * 
 * Provides Git diff statistics (lines added/deleted) for files
 * Uses `git diff --numstat` for fast and accurate results
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface DiffStats {
  added: number;
  deleted: number;
  hasChanges: boolean;
}

export interface FileDiffInfo {
  path: string;
  stats: DiffStats;
}

/**
 * Git Diff Service
 * Calculates lines added/deleted for files using git diff --numstat
 */
export class GitDiffService {
  private workspaceRoot: string;
  private diffCache: Map<string, { stats: DiffStats; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 5 seconds cache

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get diff stats for a single file
   * Checks both unstaged and staged changes, and handles new files
   */
  async getFileDiffStats(filePath: string): Promise<DiffStats> {
    console.log(`[GitDiffService] Getting diff stats for: ${filePath}`);

    // Check cache first
    const cached = this.diffCache.get(filePath);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`[GitDiffService] Cache hit for ${filePath}:`, cached.stats);
      return cached.stats;
    }

    try {
      // Try unstaged changes first
      console.log(`[GitDiffService] Checking unstaged changes for ${filePath}`);
      let stats = await this.getUnstagedDiffStats(filePath);
      console.log(`[GitDiffService] Unstaged stats:`, stats);

      // If no unstaged changes, check staged changes
      if (!stats.hasChanges) {
        console.log(`[GitDiffService] Checking staged changes for ${filePath}`);
        stats = await this.getStagedDiffStats(filePath);
        console.log(`[GitDiffService] Staged stats:`, stats);
      }

      // If still no changes, check if it's a new untracked file
      if (!stats.hasChanges) {
        console.log(`[GitDiffService] Checking if ${filePath} is a new untracked file`);
        stats = await this.getNewFileDiffStats(filePath);
        console.log(`[GitDiffService] New file stats:`, stats);
      }

      // Cache the result
      this.diffCache.set(filePath, { stats, timestamp: Date.now() });

      console.log(`[GitDiffService] Final stats for ${filePath}:`, stats);
      return stats;
    } catch (error) {
      console.error(`[GitDiffService] Error getting diff stats for ${filePath}:`, error);
      return { added: 0, deleted: 0, hasChanges: false };
    }
  }

  /**
   * Get diff stats for unstaged changes
   */
  private async getUnstagedDiffStats(filePath: string): Promise<DiffStats> {
    try {
      const { stdout } = await execAsync(
        `git diff --numstat -- "${filePath}"`,
        { cwd: this.workspaceRoot }
      );

      return this.parseNumstatOutput(stdout);
    } catch (error) {
      return { added: 0, deleted: 0, hasChanges: false };
    }
  }

  /**
   * Get diff stats for staged changes
   */
  private async getStagedDiffStats(filePath: string): Promise<DiffStats> {
    try {
      const { stdout } = await execAsync(
        `git diff --cached --numstat -- "${filePath}"`,
        { cwd: this.workspaceRoot }
      );

      return this.parseNumstatOutput(stdout);
    } catch (error) {
      return { added: 0, deleted: 0, hasChanges: false };
    }
  }

  /**
   * Get diff stats for new untracked files
   * Counts the number of lines in the file as "added"
   */
  private async getNewFileDiffStats(filePath: string): Promise<DiffStats> {
    try {
      // Check if file is untracked
      const { stdout: statusOutput } = await execAsync(
        `git status --porcelain -- "${filePath}"`,
        { cwd: this.workspaceRoot }
      );

      // If file starts with "??" it's untracked (new file)
      if (statusOutput.trim().startsWith('??')) {
        console.log(`[GitDiffService] ${filePath} is a new untracked file`);

        // Count lines in the file
        const fs = require('fs');
        const path = require('path');
        const fullPath = path.join(this.workspaceRoot, filePath);

        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const lines = content.split('\n').length;
          console.log(`[GitDiffService] New file has ${lines} lines`);

          return {
            added: lines,
            deleted: 0,
            hasChanges: true
          };
        }
      }

      return { added: 0, deleted: 0, hasChanges: false };
    } catch (error) {
      console.error(`[GitDiffService] Error checking new file status:`, error);
      return { added: 0, deleted: 0, hasChanges: false };
    }
  }

  /**
   * Parse git diff --numstat output
   * Format: "<added>\t<deleted>\t<filename>"
   */
  private parseNumstatOutput(output: string): DiffStats {
    if (!output.trim()) {
      return { added: 0, deleted: 0, hasChanges: false };
    }

    const lines = output.trim().split('\n');
    let totalAdded = 0;
    let totalDeleted = 0;

    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        totalAdded += added;
        totalDeleted += deleted;
      }
    }

    return {
      added: totalAdded,
      deleted: totalDeleted,
      hasChanges: totalAdded > 0 || totalDeleted > 0
    };
  }

  /**
   * Get the actual diff content (patch) for a file
   */
  async getFileDiffContent(filePath: string): Promise<string> {
    try {
      // Get diff against HEAD
      const { stdout } = await execAsync(
        `git diff HEAD -- "${filePath}"`,
        { cwd: this.workspaceRoot }
      );
      return stdout;
    } catch (error) {
      console.error(`[GitDiffService] Error getting diff content for ${filePath}:`, error);
      throw error; // Rethrow to allow caller to handle fallback
    }
  }

  /**
   * Check if a file is tracked by Git
   */
  async isTracked(filePath: string): Promise<boolean> {
    try {
      await execAsync(
        `git ls-files --error-unmatch -- "${filePath}"`,
        { cwd: this.workspaceRoot }
      );
      return true;
    } catch (error) {
      // non-zero exit code means file is not tracked
      return false;
    }
  }

  /**
   * Get diff stats for multiple files
   */
  async getMultipleFileDiffStats(filePaths: string[]): Promise<FileDiffInfo[]> {
    const results = await Promise.all(
      filePaths.map(async (path) => ({
        path,
        stats: await this.getFileDiffStats(path)
      }))
    );

    return results;
  }

  /**
   * Get all changed files with their diff stats
   */
  async getAllChangedFiles(): Promise<FileDiffInfo[]> {
    try {
      // Get all changed files (unstaged + staged)
      const { stdout: unstagedFiles } = await execAsync(
        'git diff --name-only',
        { cwd: this.workspaceRoot }
      );

      const { stdout: stagedFiles } = await execAsync(
        'git diff --cached --name-only',
        { cwd: this.workspaceRoot }
      );

      // Combine and deduplicate
      const allFiles = new Set([
        ...unstagedFiles.split('\n').filter(f => f.trim()),
        ...stagedFiles.split('\n').filter(f => f.trim())
      ]);

      // Get stats for all files
      return await this.getMultipleFileDiffStats(Array.from(allFiles));
    } catch (error) {
      console.error('[GitDiffService] Error getting all changed files:', error);
      return [];
    }
  }

  /**
   * Format diff stats for display
   * Returns: "+90 -45" or "" if no changes
   */
  static formatDiffStats(stats: DiffStats): string {
    if (!stats.hasChanges) {
      return '';
    }

    const parts: string[] = [];
    if (stats.added > 0) {
      parts.push(`+${stats.added}`);
    }
    if (stats.deleted > 0) {
      parts.push(`-${stats.deleted}`);
    }

    return parts.join(' ');
  }

  /**
   * Apply a diff patch to a file (used by Checkpoint restore)
   */
  async applyDiff(filePath: string, diffContent: string): Promise<void> {
    const tempDiffFile = path.join(this.workspaceRoot, `.gently_temp_${Date.now()}.diff`);
    try {
      await fs.promises.writeFile(tempDiffFile, diffContent, 'utf-8');
      await execAsync(`git apply --whitespace=fix "${tempDiffFile}"`, { cwd: this.workspaceRoot });
    } finally {
      await fs.promises.unlink(tempDiffFile).catch(() => { });
    }
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.diffCache.clear();
  }

  /**
   * Check if a file has any changes
   */
  async hasChanges(filePath: string): Promise<boolean> {
    const stats = await this.getFileDiffStats(filePath);
    return stats.hasChanges;
  }

  /**
   * Get total diff stats for all changed files
   */
  async getTotalDiffStats(): Promise<DiffStats> {
    const allFiles = await this.getAllChangedFiles();

    let totalAdded = 0;
    let totalDeleted = 0;

    for (const file of allFiles) {
      totalAdded += file.stats.added;
      totalDeleted += file.stats.deleted;
    }

    return {
      added: totalAdded,
      deleted: totalDeleted,
      hasChanges: totalAdded > 0 || totalDeleted > 0
    };
  }
}

