// =====================================================
// FileOperationManager Tests
// =====================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import * as vscode from 'vscode';
import { FileOperationManager } from '../FileOperationManager';
import { FileOperations } from '../../fileOperations';
import { CodebaseIndexer } from '../../CodebaseIndexer';
import { ContextManager } from '../../contextManager';
import { FileReferenceManager } from '../../fileReferenceManager';
import { IncrementalIndexer } from '../../IncrementalIndexer';

// Mock dependencies
// Mock dependencies are handled by manual mocking in beforeEach

describe('FileOperationManager', () => {
  let fileOperationManager: FileOperationManager;
  let mockFileOps: any;
  let mockIndexer: any;
  let mockContextManager: any;
  let mockFileReferenceManager: any;
  let mockIncrementalIndexer: any;

  beforeEach(() => {
    // Create mock instances
    mockFileOps = {
      readFile: vi.fn(),
      readFiles: vi.fn(),
      writeFile: vi.fn(),
      editFile: vi.fn(),
      deleteFile: vi.fn(),
      applyChanges: vi.fn(),
      fileExists: vi.fn(),
      getFileContent: vi.fn(),
      listFiles: vi.fn(),
      getWorkspaceRoot: vi.fn()
    } as any;

    mockIndexer = {
      indexWorkspace: vi.fn(),
      indexFile: vi.fn(),
      generateEmbeddings: vi.fn(),
      findRelevantFiles: vi.fn(),
      findRelevantFilesHybrid: vi.fn(),
      getAllIndexedFiles: vi.fn(),
      clearIndex: vi.fn(),
      getRetrieverStats: vi.fn(),
      onUpdate: vi.fn(),
      offUpdate: vi.fn()
    } as any;

    mockContextManager = {
      trackFileAccess: vi.fn(),
      getAllFiles: vi.fn(),
      getStats: vi.fn(),
      pinFile: vi.fn(),
      unpinFile: vi.fn()
    } as any;

    mockFileReferenceManager = {
      parseReferences: vi.fn(),
      searchFiles: vi.fn(),
      loadReferences: vi.fn(),
      generateContextPrompt: vi.fn(),
      formatFileSize: vi.fn(),
      isFileTooLarge: vi.fn()
    } as any;

    mockIncrementalIndexer = {
      start: vi.fn(),
      stop: vi.fn(),
      getStats: vi.fn(),
      flush: vi.fn(),
      onUpdate: vi.fn(),
      offUpdate: vi.fn()
    } as any;

    // No additional setup needed - mocks are already defined above

    // Create FileOperationManager instance
    fileOperationManager = new FileOperationManager(
      mockFileOps,
      mockIndexer,
      mockContextManager,
      mockFileReferenceManager,
      mockIncrementalIndexer,
      { debug: true }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await fileOperationManager.initialize();
      
      expect(mockIncrementalIndexer.start).toHaveBeenCalled();
    });

    it('should dispose successfully', () => {
      fileOperationManager.dispose();
      
      expect(mockIncrementalIndexer.stop).toHaveBeenCalled();
    });
  });

  describe('File Operations', () => {
    it('should read file and track access', async () => {
      const mockFileInfo = {
        path: 'test.ts',
        name: 'test.ts',
        content: 'console.log("test");',
        language: 'typescript',
        size: 20
      };

      mockFileOps.readFile.mockResolvedValue(mockFileInfo);

      const result = await fileOperationManager.readFile('test.ts');

      expect(mockFileOps.readFile).toHaveBeenCalledWith('test.ts');
      expect(mockContextManager.trackFileAccess).toHaveBeenCalledWith(
        mockFileInfo.path,
        mockFileInfo.content,
        mockFileInfo.language,
        mockFileInfo.size
      );
      expect(result).toEqual(mockFileInfo);
    });

    it('should write file successfully', async () => {
      await fileOperationManager.writeFile('test.ts', 'console.log("test");');

      expect(mockFileOps.writeFile).toHaveBeenCalledWith('test.ts', 'console.log("test");');
    });

    it('should edit file successfully', async () => {
      const edit = {
        filePath: 'test.ts',
        startLine: 0,
        endLine: 0,
        newContent: 'console.log("edited");'
      };

      await fileOperationManager.editFile(edit);

      expect(mockFileOps.editFile).toHaveBeenCalledWith(edit);
    });

    it('should delete file successfully', async () => {
      await fileOperationManager.deleteFile('test.ts');

      expect(mockFileOps.deleteFile).toHaveBeenCalledWith('test.ts');
    });
  });

  describe('Context Management', () => {
    it('should track file access', () => {
      fileOperationManager.trackFileAccess('test.ts', 'content', 'typescript', 20);

      expect(mockContextManager.trackFileAccess).toHaveBeenCalledWith(
        'test.ts',
        'content',
        'typescript',
        20
      );
    });

    it('should get all files', () => {
      const mockFiles = [{ path: 'test.ts', score: 100, lastUsed: Date.now(), usageCount: 1, tokenCount: 10, inContext: true, pinned: false, language: 'typescript', size: 20 }];
      mockContextManager.getAllFiles.mockReturnValue(mockFiles);

      const result = fileOperationManager.getAllFiles();

      expect(mockContextManager.getAllFiles).toHaveBeenCalled();
      expect(result).toEqual(mockFiles);
    });

    it('should get context stats', () => {
      const mockStats = {
        totalFiles: 10,
        filesInContext: 5,
        totalTokens: 1000,
        maxTokens: 8000,
        utilizationPercent: 12.5
      };
      mockContextManager.getStats.mockReturnValue(mockStats);

      const result = fileOperationManager.getContextStats();

      expect(mockContextManager.getStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    it('should pin file', () => {
      fileOperationManager.pinFile('test.ts');

      expect(mockContextManager.pinFile).toHaveBeenCalledWith('test.ts');
    });

    it('should unpin file', () => {
      fileOperationManager.unpinFile('test.ts');

      expect(mockContextManager.unpinFile).toHaveBeenCalledWith('test.ts');
    });
  });

  describe('Indexing Operations', () => {
    it('should index workspace', async () => {
      const progressCallback = vi.fn();
      
      await fileOperationManager.indexWorkspace(progressCallback);

      expect(mockIndexer.indexWorkspace).toHaveBeenCalledWith(progressCallback);
    });

    it('should index single file', async () => {
      await fileOperationManager.indexFile('test.ts', true);

      expect(mockIndexer.indexFile).toHaveBeenCalledWith('test.ts', true);
    });

    it('should generate embeddings', async () => {
      const progressCallback = vi.fn();
      
      await fileOperationManager.generateEmbeddings(progressCallback);

      expect(mockIndexer.generateEmbeddings).toHaveBeenCalledWith(progressCallback);
    });
  });

  describe('Search Operations', () => {
    it('should find relevant files', async () => {
      const mockResults = [
        { filePath: 'test.ts', score: 90, reason: 'filename match' }
      ];
      mockIndexer.findRelevantFiles.mockResolvedValue(mockResults);

      const result = await fileOperationManager.findRelevantFiles('test', 5);

      expect(mockIndexer.findRelevantFiles).toHaveBeenCalledWith('test', 5);
      expect(result).toEqual(mockResults);
    });

    it('should find relevant files with hybrid search', async () => {
      const mockResults = [
        { filePath: 'test.ts', score: 90, reason: 'semantic match' }
      ];
      mockIndexer.findRelevantFilesHybrid.mockResolvedValue(mockResults);

      const result = await fileOperationManager.findRelevantFilesHybrid('test', 5);

      expect(mockIndexer.findRelevantFilesHybrid).toHaveBeenCalledWith('test', 5);
      expect(result).toEqual(mockResults);
    });
  });

  describe('File Reference Operations', () => {
    it('should parse references', () => {
      const input = '@test.ts can you check this file?';
      const expectedResult = {
        cleanedMessage: 'can you check this file?',
        references: [{ type: 'file', path: 'test.ts', displayName: 'test.ts' }]
      };
      mockFileReferenceManager.parseReferences.mockReturnValue(expectedResult);

      const result = fileOperationManager.parseReferences(input);

      expect(mockFileReferenceManager.parseReferences).toHaveBeenCalledWith(input);
      expect(result).toEqual(expectedResult);
    });

    it('should search files', async () => {
      const mockReferences = [{ type: 'file', path: 'test.ts', displayName: 'test.ts' }];
      mockFileReferenceManager.searchFiles.mockResolvedValue(mockReferences);

      const result = await fileOperationManager.searchFiles('test', 10);

      expect(mockFileReferenceManager.searchFiles).toHaveBeenCalledWith('test', 10);
      expect(result).toEqual(mockReferences);
    });

    it('should load references', async () => {
      const references = [{ type: 'file', path: 'test.ts' }];
      const mockLoadedReferences = [{ type: 'file', path: 'test.ts', content: 'content' }];
      mockFileReferenceManager.loadReferences.mockResolvedValue(mockLoadedReferences);

      const result = await fileOperationManager.loadReferences(references);

      expect(mockFileReferenceManager.loadReferences).toHaveBeenCalledWith(references);
      expect(result).toEqual(mockLoadedReferences);
    });

    it('should generate context prompt', () => {
      const references = [{ type: 'file', path: 'test.ts', content: 'content' }];
      const mockPrompt = 'Generated prompt';
      mockFileReferenceManager.generateContextPrompt.mockReturnValue(mockPrompt);

      const result = fileOperationManager.generateContextPrompt(references);

      expect(mockFileReferenceManager.generateContextPrompt).toHaveBeenCalledWith(references);
      expect(result).toEqual(mockPrompt);
    });
  });

  describe('Utility Methods', () => {
    it('should format file size', () => {
      const result = fileOperationManager.formatFileSize(1024);
      
      expect(mockFileReferenceManager.formatFileSize).toHaveBeenCalledWith(1024);
      expect(result).toBe('1.0KB');
    });

    it('should check if file is too large', () => {
      const result = fileOperationManager.isFileTooLarge(100000);
      
      expect(mockFileReferenceManager.isFileTooLarge).toHaveBeenCalledWith(100000);
      expect(result).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should get workspace root', () => {
      mockFileOps.getWorkspaceRoot.mockReturnValue('/workspace');
      
      const result = fileOperationManager.getWorkspaceRoot();
      
      expect(mockFileOps.getWorkspaceRoot).toHaveBeenCalled();
      expect(result).toBe('/workspace');
    });

    it('should get indexer instance', () => {
      const result = fileOperationManager.getIndexer();
      
      expect(result).toBe(mockIndexer);
    });

    it('should get context manager instance', () => {
      const result = fileOperationManager.getContextManager();
      
      expect(result).toBe(mockContextManager);
    });

    it('should get incremental indexer instance', () => {
      const result = fileOperationManager.getIncrementalIndexer();
      
      expect(result).toBe(mockIncrementalIndexer);
    });

    it('should get file reference manager instance', () => {
      const result = fileOperationManager.getFileReferenceManager();
      
      expect(result).toBe(mockFileReferenceManager);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should get retriever stats', () => {
      const mockStats = { totalDocuments: 100, indexedDocuments: 100 };
      mockIndexer.getRetrieverStats.mockReturnValue(mockStats);

      const result = fileOperationManager.getRetrieverStats();

      expect(mockIndexer.getRetrieverStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    it('should get incremental indexer stats', () => {
      const mockStats = { totalFiles: 100, pendingUpdates: 0, isProcessing: false };
      mockIncrementalIndexer.getStats.mockReturnValue(mockStats);

      const result = fileOperationManager.getIncrementalIndexerStats();

      expect(mockIncrementalIndexer.getStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });

    it('should clear index', () => {
      fileOperationManager.clearIndex();

      expect(mockIndexer.clearIndex).toHaveBeenCalled();
    });

    it('should flush pending updates', async () => {
      await fileOperationManager.flushPendingUpdates();

      expect(mockIncrementalIndexer.flush).toHaveBeenCalled();
    });

    it('should register index update callback', () => {
      const callback = vi.fn();
      
      fileOperationManager.onIndexUpdate(callback);

      expect(mockIncrementalIndexer.onUpdate).toHaveBeenCalledWith(callback);
    });

    it('should unregister index update callback', () => {
      const callback = vi.fn();
      
      fileOperationManager.offIndexUpdate(callback);

      expect(mockIncrementalIndexer.offUpdate).toHaveBeenCalledWith(callback);
    });
  });
});