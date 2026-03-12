// =====================================================
// Agent Manager Interfaces
// =====================================================

import * as vscode from 'vscode';
import { FileOperations, FileInfo, FileChange } from '../fileOperations';
import { CodebaseIndexer, SearchResult } from '../CodebaseIndexer';
import { ContextManager, ContextFile, ContextStats } from '../contextManager';
import { FileReferenceManager } from '../fileReferenceManager';
import { IncrementalIndexer } from '../IncrementalIndexer';

/**
 * Base interface for all agent services
 */
export interface IAgentService {
  initialize?(): Promise<void>;
  dispose?(): void;
}

/**
 * File Operation Service Interface
 */
export interface IFileOperationService extends IAgentService {
  // Core file operations
  readFile(filePath: string): Promise<FileInfo>;
  readFiles(filePaths: string[]): Promise<FileInfo[]>;
  writeFile(filePath: string, content: string): Promise<void>;
  editFile(edit: any): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  applyChanges(changes: FileChange[]): Promise<void>;
  
  // File utilities
  fileExists(filePath: string): Promise<boolean>;
  getFileContent(filePath: string): Promise<string>;
  listFiles(pattern?: string, exclude?: string): Promise<string[]>;
  
  // Context management
  trackFileAccess(filePath: string, content: string, language: string, size: number): void;
  
  // Context management methods
  getAllFiles(): ContextFile[];
  getContextStats(): ContextStats;
  pinFile(filePath: string): void;
  unpinFile(filePath: string): void;
  getTrackedFiles(): ContextFile[];
  
  // Backward compatibility
  findRelevantFiles(query: string, maxResults?: number): Promise<SearchResult[]>;
}

/**
 * Indexing Service Interface
 */
export interface IIndexingService extends IAgentService {
  indexWorkspace(progressCallback?: (progress: number, total: number) => void): Promise<void>;
  indexFile(filePath: string, generateEmbedding?: boolean): Promise<void>;
  generateEmbeddings(progressCallback?: (progress: number, total: number) => void): Promise<void>;
  
  // Search functionality
  findRelevantFiles(query: string, maxResults?: number): Promise<SearchResult[]>;
  findRelevantFilesHybrid(query: string, maxResults?: number): Promise<SearchResult[]>;
  
  // File management
  getFileIndex(filePath: string): any;
  getAllIndexedFiles(): string[];
  clearIndex(): void;
  
  // Statistics
  getRetrieverStats(): any;
  getStats(): any;
  
  // Callbacks
  onUpdate(callback: () => void): void;
  offUpdate(callback: () => void): void;
}

/**
 * File Reference Service Interface
 */
export interface IFileReferenceService extends IAgentService {
  parseReferences(input: string): { cleanedMessage: string; references: any[] };
  searchFiles(query: string, maxResults?: number): Promise<any[]>;
  loadReferences(references: any[]): Promise<any[]>;
  generateContextPrompt(references: any[]): string;
  
  // Utilities
  formatFileSize(bytes: number): string;
  isFileTooLarge(bytes: number): boolean;
}

/**
 * Core Dependencies Interface
 */
export interface IAgentDependencies {
  context: vscode.ExtensionContext;
  fileOps: FileOperations;
  indexer: CodebaseIndexer;
  contextManager: ContextManager;
  fileReferenceManager: FileReferenceManager;
  incrementalIndexer: IncrementalIndexer;
}

/**
 * Service Configuration Interface
 */
export interface IServiceConfig {
  enabled: boolean;
  debug: boolean;
  maxRetries: number;
  timeout: number;
}