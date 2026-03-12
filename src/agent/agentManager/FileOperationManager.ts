// =====================================================
// FileOperationManager - Refactored
// =====================================================

import * as vscode from 'vscode';
import { 
  IFileOperationService, 
  IIndexingService, 
  IFileReferenceService,
  IServiceConfig 
} from './interfaces';
import { 
  FileOperations, 
  FileInfo, 
  FileChange, 
  EditOperation 
} from '../fileOperations';
import { 
  CodebaseIndexer, 
  SearchResult 
} from '../CodebaseIndexer';
import { 
  ContextManager, 
  ContextFile, 
  ContextStats 
} from '../contextManager';
import { FileReferenceManager } from '../fileReferenceManager';
import { IncrementalIndexer } from '../IncrementalIndexer';

export class FileOperationManager implements IFileOperationService {
  // Core services
  private fileOps: FileOperations;
  private indexer: CodebaseIndexer;
  private contextManager: ContextManager;
  private fileReferenceManager: FileReferenceManager;
  private incrementalIndexer: IncrementalIndexer;
  
  // Configuration
  private config: IServiceConfig;

  constructor(
    fileOps: FileOperations,
    indexer: CodebaseIndexer,
    contextManager: ContextManager,
    fileReferenceManager: FileReferenceManager,
    incrementalIndexer: IncrementalIndexer,
    config: Partial<IServiceConfig> = {}
  ) {
    this.fileOps = fileOps;
    this.indexer = indexer;
    this.contextManager = contextManager;
    this.fileReferenceManager = fileReferenceManager;
    this.incrementalIndexer = incrementalIndexer;
    
    this.config = {
      enabled: true,
      debug: false,
      maxRetries: 3,
      timeout: 30000,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      // Start incremental indexer for real-time file watching
      this.incrementalIndexer.start();
      
      if (this.config.debug) {
        console.log('[FileOperationManager] Initialized successfully');
      }
    } catch (error) {
      console.error('[FileOperationManager] Initialization failed:', error);
      throw error;
    }
  }

  dispose(): void {
    try {
      // Stop incremental indexer
      this.incrementalIndexer.stop();
      
      if (this.config.debug) {
        console.log('[FileOperationManager] Disposed successfully');
      }
    } catch (error) {
      console.error('[FileOperationManager] Error during disposal:', error);
    }
  }

  // ==================== FILE OPERATIONS ====================

  async readFile(filePath: string): Promise<FileInfo> {
    try {
      const fileInfo = await this.fileOps.readFile(filePath);

      // Track file access in context manager
      this.contextManager.trackFileAccess(
        fileInfo.path,
        fileInfo.content,
        fileInfo.language,
        fileInfo.size
      );

      return fileInfo;
    } catch (error) {
      console.error(`[FileOperationManager] Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  async readFiles(filePaths: string[]): Promise<FileInfo[]> {
    return this.fileOps.readFiles(filePaths);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    return this.fileOps.writeFile(filePath, content);
  }

  async editFile(edit: EditOperation): Promise<void> {
    return this.fileOps.editFile(edit);
  }

  async deleteFile(filePath: string): Promise<void> {
    return this.fileOps.deleteFile(filePath);
  }

  async applyChanges(changes: FileChange[]): Promise<void> {
    return this.fileOps.applyChanges(changes);
  }

  async fileExists(filePath: string): Promise<boolean> {
    return this.fileOps.fileExists(filePath);
  }

  async getFileContent(filePath: string): Promise<string> {
    return this.fileOps.getFileContent(filePath);
  }

  async listFiles(pattern?: string, exclude?: string): Promise<string[]> {
    return this.fileOps.listFiles(pattern, exclude);
  }

  // ==================== CONTEXT MANAGEMENT ====================

  trackFileAccess(filePath: string, content: string, language: string, size: number): void {
    this.contextManager.trackFileAccess(filePath, content, language, size);
  }

  getAllFiles(): ContextFile[] {
    return this.contextManager.getAllFiles();
  }

  getContextStats(): ContextStats {
    return this.contextManager.getStats();
  }

  pinFile(filePath: string): void {
    this.contextManager.pinFile(filePath);
  }

  unpinFile(filePath: string): void {
    this.contextManager.unpinFile(filePath);
  }

  getTrackedFiles(): ContextFile[] {
    return this.contextManager.getAllFiles();
  }

  // ==================== INDEXING OPERATIONS ====================

  async indexWorkspace(progressCallback?: (progress: number, total: number) => void): Promise<void> {
    return this.indexer.indexWorkspace(progressCallback);
  }

  async indexFile(filePath: string, generateEmbedding: boolean = false): Promise<void> {
    return this.indexer.indexFile(filePath, generateEmbedding);
  }

  async generateEmbeddings(progressCallback?: (progress: number, total: number) => void): Promise<void> {
    return this.indexer.generateEmbeddings(progressCallback);
  }

  // ==================== SEARCH OPERATIONS ====================

  async findRelevantFiles(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    return this.indexer.findRelevantFiles(query, maxResults);
  }

  async findRelevantFilesHybrid(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    return this.indexer.findRelevantFilesHybrid(query, maxResults);
  }

  // ==================== FILE REFERENCE OPERATIONS ====================

  parseReferences(input: string): { cleanedMessage: string; references: any[] } {
    return this.fileReferenceManager.parseReferences(input);
  }

  async searchFiles(query: string, maxResults: number = 10): Promise<any[]> {
    return this.fileReferenceManager.searchFiles(query, maxResults);
  }

  async loadReferences(references: any[]): Promise<any[]> {
    return this.fileReferenceManager.loadReferences(references);
  }

  generateContextPrompt(references: any[]): string {
    return this.fileReferenceManager.generateContextPrompt(references);
  }

  // ==================== UTILITY METHODS ====================

  formatFileSize(bytes: number): string {
    return this.fileReferenceManager.formatFileSize(bytes);
  }

  isFileTooLarge(bytes: number): boolean {
    return this.fileReferenceManager.isFileTooLarge(bytes);
  }

  // ==================== BACKWARD COMPATIBILITY ====================

  /**
   * @deprecated Use findRelevantFiles instead
   */
  async findRelevantFilesLegacy(query: string, maxResults: number = 5): Promise<SearchResult[]> {
    return this.findRelevantFiles(query, maxResults);
  }

  /**
   * Get workspace root path
   */
  getWorkspaceRoot(): string {
    return this.fileOps.getWorkspaceRoot();
  }

  /**
   * Get file indexer instance
   */
  getIndexer(): CodebaseIndexer {
    return this.indexer;
  }

  /**
   * Get context manager instance
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Get incremental indexer instance
   */
  getIncrementalIndexer(): IncrementalIndexer {
    return this.incrementalIndexer;
  }

  /**
   * Get file reference manager instance
   */
  getFileReferenceManager(): FileReferenceManager {
    return this.fileReferenceManager;
  }

  // ==================== STATISTICS AND MONITORING ====================

  /**
   * Get indexing statistics
   */
  getRetrieverStats(): any {
    return this.indexer.getRetrieverStats();
  }

  /**
   * Get incremental indexer statistics
   */
  getIncrementalIndexerStats(): any {
    return this.incrementalIndexer.getStats();
  }

  /**
   * Clear all indexes
   */
  clearIndex(): void {
    this.indexer.clearIndex();
  }

  /**
   * Force flush pending updates
   */
  async flushPendingUpdates(): Promise<void> {
    return this.incrementalIndexer.flush();
  }

  /**
   * Register callback for index updates
   */
  onIndexUpdate(callback: () => void): void {
    this.incrementalIndexer.onUpdate(callback);
  }

  /**
   * Unregister index update callback
   */
  offIndexUpdate(callback: () => void): void {
    this.incrementalIndexer.offUpdate(callback);
  }
}