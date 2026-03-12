/**
 * Incremental Indexer for Gently
 */

import * as vscode from 'vscode';
import { CodebaseIndexer } from './CodebaseIndexer';

interface IndexUpdate {
  uri: vscode.Uri;
  type: 'create' | 'change' | 'delete';
  timestamp: number;
}

interface IndexStats {
  totalFiles: number;
  pendingUpdates: number;
  lastUpdateTime: number;
  isProcessing: boolean;
}

type IndexUpdateCallback = () => void;

export class IncrementalIndexer {
  private indexer: CodebaseIndexer;
  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private updateQueue: Map<string, IndexUpdate> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isProcessing: boolean = false;
  private updateCallbacks: Set<IndexUpdateCallback> = new Set();
  private lastIndexedTimes: Map<string, number> = new Map();

  // Configuration
  private readonly DEBOUNCE_DELAY = 500; // Wait 500ms after last change
  private readonly BATCH_SIZE = 10; // Process 10 files at a time
  private readonly PROCESS_INTERVAL = 100; // Check queue every 100ms

  constructor(indexer: CodebaseIndexer) {
    this.indexer = indexer;
  }

  /**
   * Start watching for file changes
   */
  start(): void {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,js,tsx,jsx,py,java,cpp,c,h,hpp,cs,go,rs,rb,php,swift,kt,scala,sh,md,json,yaml,yml,xml,html,css,scss,sass,less}',
      false,
      false,
      false
    );

    setTimeout(() => {
      this.fileWatcher!.onDidCreate(uri => this.onFileCreated(uri));
      this.fileWatcher!.onDidChange(uri => this.onFileChanged(uri));
      this.fileWatcher!.onDidDelete(uri => this.onFileDeleted(uri));
    }, 2000);

    this.startProcessingQueue();
  }

  /**
   * Stop watching for file changes
   */
  stop(): void {
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.updateQueue.clear();
  }

  private shouldIgnoreFile(uri: vscode.Uri): boolean {
    const filePath = uri.fsPath.toLowerCase();
    const ignorePatterns = [
      'node_modules', '.git', 'dist', 'build', 'out', '.vscode', '.next', '.nuxt',
      'coverage', '.cache', 'tmp', 'temp', '.temp', '_temp', 'deps_temp', 'chunk-',
      '.vite', '.turbo', '.vercel', '.netlify'
    ];

    return ignorePatterns.some(pattern => filePath.includes(pattern));
  }

  private onFileCreated(uri: vscode.Uri): void {
    if (this.shouldIgnoreFile(uri)) return;
    this.queueUpdate(uri, 'create');
  }

  private onFileChanged(uri: vscode.Uri): void {
    if (this.shouldIgnoreFile(uri)) return;
    this.queueUpdate(uri, 'change');
  }

  private onFileDeleted(uri: vscode.Uri): void {
    if (this.shouldIgnoreFile(uri)) return;
    this.queueUpdate(uri, 'delete');
  }

  private queueUpdate(uri: vscode.Uri, type: 'create' | 'change' | 'delete'): void {
    const filePath = uri.fsPath;
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.updateQueue.set(filePath, { uri, type, timestamp: Date.now() });
      this.debounceTimers.delete(filePath);
    }, this.DEBOUNCE_DELAY);

    this.debounceTimers.set(filePath, timer);
  }

  private startProcessingQueue(): void {
    setInterval(() => {
      if (!this.isProcessing && this.updateQueue.size > 0) {
        this.processQueue();
      }
    }, this.PROCESS_INTERVAL);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const updates = Array.from(this.updateQueue.entries()).slice(0, this.BATCH_SIZE);
      if (updates.length > 0) {
        for (const [filePath, update] of updates) {
          try {
            await this.processUpdate(update);
            this.updateQueue.delete(filePath);
          } catch (error) {
            console.error(`[IncrementalIndexer] Error: ${filePath}`, error);
          }
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async processUpdate(update: IndexUpdate): Promise<void> {
    const filePath = update.uri.fsPath;

    switch (update.type) {
      case 'create':
      case 'change':
        try {
          await vscode.workspace.fs.stat(update.uri);
          const now = Date.now();
          const lastIndexed = this.lastIndexedTimes.get(filePath) || 0;
          if (now - lastIndexed > 3000) {
            await this.indexer.indexFile(filePath);
            this.lastIndexedTimes.set(filePath, now);
          }
        } catch (error: any) {
          if (error.code === 'FileNotFound' || error.message?.includes('not found')) {
            await this.indexer.removeFile(filePath);
          } else {
            throw error;
          }
        }
        break;

      case 'delete':
        await this.indexer.removeFile(filePath);
        break;
    }
    this.notifyUpdateCallbacks();
  }

  getStats(): IndexStats {
    return {
      totalFiles: this.indexer.getAllIndexedFiles().length,
      pendingUpdates: this.updateQueue.size,
      lastUpdateTime: Date.now(),
      isProcessing: this.isProcessing
    };
  }

  async flush(): Promise<void> {
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();

    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    while (this.updateQueue.size > 0) {
      await this.processQueue();
    }
  }

  onUpdate(callback: IndexUpdateCallback): void {
    this.updateCallbacks.add(callback);
  }

  offUpdate(callback: IndexUpdateCallback): void {
    this.updateCallbacks.delete(callback);
  }

  private notifyUpdateCallbacks(): void {
    for (const callback of this.updateCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error('[IncrementalIndexer] Callback error:', error);
      }
    }
  }
}
