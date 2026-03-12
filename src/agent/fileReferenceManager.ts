/**
 * File Reference Manager for @file mentions
 * 
 * Handles parsing, searching, and loading file references from user input
 * Phase 1: @file support
 * Phase 2: @folder, @selection, @workspace support
 */

import * as vscode from 'vscode';
import { FileOperations, FileInfo } from './fileOperations';
import { CodebaseIndexer } from './CodebaseIndexer';

export interface FileReference {
  type: 'file' | 'folder' | 'selection';
  path: string;
  displayName: string;
  size?: number;
  language?: string;
  content?: string;
  fileCount?: number; // For folders
  lineRange?: { start: number; end: number }; // For selections
  warning?: string; // For large files or folders
  diffStats?: { added: number; deleted: number }; // Git diff statistics
}

export interface ParsedInput {
  cleanedMessage: string;
  references: FileReference[];
}

export class FileReferenceManager {
  private fileOps: FileOperations;
  private indexer: CodebaseIndexer;

  constructor(fileOps: FileOperations, indexer: CodebaseIndexer) {
    this.fileOps = fileOps;
    this.indexer = indexer;
  }

  /**
   * Parse @file, @folder, @selection references from user input
   * Examples:
   * - "@src/auth.ts can you refactor this?" → file reference
   * - "@src/auth explain this folder" → folder reference
   * - "@selection what does this do?" → selection reference
   */
  parseReferences(input: string): ParsedInput {
    const references: FileReference[] = [];
    let cleanedMessage = input;

    // 1. Check for @selection
    const selectionRegex = /@selection\b/gi;
    if (selectionRegex.test(input)) {
      references.push({
        type: 'selection',
        path: 'selection',
        displayName: 'Current Selection',
      });
      cleanedMessage = cleanedMessage.replace(selectionRegex, '').trim();
    }

    // 2. Check for @folder references (path without file extension)
    // Matches: @path/to/folder or @folder
    const folderRegex = /@([a-zA-Z0-9_\-./\\]+)(?!\.[a-zA-Z0-9]+)/g;
    let match;
    while ((match = folderRegex.exec(input)) !== null) {
      const fullMatch = match[0]; // @src/auth
      const folderPath = match[1]; // src/auth

      // Skip if it's @selection (already handled)
      if (folderPath.toLowerCase() === 'selection') {
        continue;
      }

      references.push({
        type: 'folder',
        path: folderPath,
        displayName: this.getDisplayName(folderPath),
      });

      // Remove @folder reference from message
      cleanedMessage = cleanedMessage.replace(fullMatch, '').trim();
    }

    // 3. Check for @file references (path with file extension)
    // Matches: @path/to/file.ts or @file.ts
    const fileRegex = /@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
    while ((match = fileRegex.exec(input)) !== null) {
      const fullMatch = match[0]; // @src/auth.ts
      const filePath = match[1]; // src/auth.ts

      references.push({
        type: 'file',
        path: filePath,
        displayName: this.getDisplayName(filePath),
      });

      // Remove @file reference from message
      cleanedMessage = cleanedMessage.replace(fullMatch, '').trim();
    }

    // Clean up multiple spaces
    cleanedMessage = cleanedMessage.replace(/\s+/g, ' ').trim();

    return {
      cleanedMessage,
      references,
    };
  }

  /**
   * Search for files and folders matching a query
   * Used for autocomplete
   */
  async searchFiles(query: string, maxResults: number = 10): Promise<FileReference[]> {
    const references: FileReference[] = [];

    // Special keywords
    if ('selection'.startsWith(query.toLowerCase()) && query.length > 0) {
      references.push({
        type: 'selection',
        path: 'selection',
        displayName: '@selection',
      });
    }

    const allFiles = this.indexer.getAllIndexedFiles();
    console.log('[FileReferenceManager] Searching in', allFiles.length, 'files for query:', query);

    // Extract unique folders from files
    const folders = new Set<string>();
    allFiles.forEach(file => {
      const parts = file.split(/[\\/]/);
      for (let i = 1; i < parts.length; i++) {
        const folder = parts.slice(0, i).join('/');
        folders.add(folder);
      }
    });

    // Search folders
    const folderMatches = Array.from(folders)
      .map(folder => ({
        path: folder,
        score: this.fuzzyScore(query.toLowerCase(), folder.toLowerCase()),
        type: 'folder' as const,
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.floor(maxResults / 2)); // Half for folders

    // Search files
    const fileMatches = allFiles
      .map(filePath => ({
        path: filePath,
        score: this.fuzzyScore(query.toLowerCase(), filePath.toLowerCase()),
        type: 'file' as const,
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Combine and sort by score
    const allMatches = [...folderMatches, ...fileMatches]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    console.log('[FileReferenceManager] Found', allMatches.length, 'matches');

    for (const match of allMatches) {
      if (match.type === 'folder') {
        // Count files in folder
        const filesInFolder = allFiles.filter(f => f.startsWith(match.path + '/'));
        references.push({
          type: 'folder',
          path: match.path,
          displayName: this.getDisplayName(match.path),
          fileCount: filesInFolder.length,
        });
      } else {
        const fileInfo = await this.getFileInfo(match.path);
        references.push({
          type: 'file',
          path: match.path,
          displayName: this.getDisplayName(match.path),
          size: fileInfo?.size,
          language: fileInfo?.language,
        });
      }
    }

    return references;
  }

  /**
   * Load content for file, folder, and selection references
   */
  async loadReferences(references: FileReference[]): Promise<FileReference[]> {
    const loadedReferences: FileReference[] = [];

    for (const ref of references) {
      try {
        if (ref.type === 'file') {
          const loaded = await this.loadFileReference(ref);
          loadedReferences.push(loaded);
        } else if (ref.type === 'folder') {
          const loaded = await this.loadFolderReference(ref);
          loadedReferences.push(...loaded); // Folder returns multiple files
        } else if (ref.type === 'selection') {
          const loaded = await this.loadSelectionReference();
          if (loaded) {
            loadedReferences.push(loaded);
          }
        }
      } catch (error) {
        console.error(`Failed to load reference: ${ref.path}`, error);
        loadedReferences.push({
          ...ref,
          content: `Error loading: ${error}`,
        });
      }
    }

    return loadedReferences;
  }

  /**
   * Load a single file reference with size warning
   */
  private async loadFileReference(ref: FileReference): Promise<FileReference> {
    const fileInfo = await this.fileOps.readFile(ref.path);
    const MAX_FILE_SIZE = 50 * 1024; // 50KB

    let warning: string | undefined;
    if (fileInfo.size && fileInfo.size > MAX_FILE_SIZE) {
      warning = `⚠️ Large file (${Math.round(fileInfo.size / 1024)}KB)`;
    }

    return {
      ...ref,
      content: fileInfo.content,
      size: fileInfo.size,
      language: fileInfo.language,
      warning,
    };
  }

  /**
   * Load all files in a folder
   */
  private async loadFolderReference(ref: FileReference): Promise<FileReference[]> {
    const allFiles = this.indexer.getAllIndexedFiles();
    const folderPath = ref.path.replace(/\\/g, '/');

    // Find all files in this folder
    const filesInFolder = allFiles.filter(file => {
      const normalizedFile = file.replace(/\\/g, '/');
      return normalizedFile.startsWith(folderPath + '/') || normalizedFile.startsWith(folderPath);
    });

    console.log(`[FileReferenceManager] Found ${filesInFolder.length} files in folder: ${folderPath}`);

    const MAX_FOLDER_FILES = 20;
    const MAX_FOLDER_SIZE = 200 * 1024; // 200KB total

    let warning: string | undefined;
    if (filesInFolder.length > MAX_FOLDER_FILES) {
      warning = `⚠️ Large folder (${filesInFolder.length} files, showing first ${MAX_FOLDER_FILES})`;
    }

    // Load files (limit to MAX_FOLDER_FILES)
    const filesToLoad = filesInFolder.slice(0, MAX_FOLDER_FILES);
    const loadedFiles: FileReference[] = [];
    let totalSize = 0;

    for (const filePath of filesToLoad) {
      try {
        const fileInfo = await this.fileOps.readFile(filePath);
        totalSize += fileInfo.size || 0;

        // Stop if total size exceeds limit
        if (totalSize > MAX_FOLDER_SIZE) {
          warning = `⚠️ Folder too large (>${Math.round(MAX_FOLDER_SIZE / 1024)}KB), stopped at ${loadedFiles.length} files`;
          break;
        }

        loadedFiles.push({
          type: 'file',
          path: filePath,
          displayName: this.getDisplayName(filePath),
          content: fileInfo.content,
          size: fileInfo.size,
          language: fileInfo.language,
        });
      } catch (error) {
        console.error(`Failed to load file in folder: ${filePath}`, error);
      }
    }

    // Add folder summary as first item
    if (loadedFiles.length > 0) {
      loadedFiles[0].warning = warning;
      loadedFiles[0].fileCount = filesInFolder.length;
    }

    return loadedFiles;
  }

  /**
   * Load currently selected code from active editor
   */
  private async loadSelectionReference(): Promise<FileReference | null> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return {
        type: 'selection',
        path: 'selection',
        displayName: 'No Selection',
        content: 'No code is currently selected in the editor.',
        warning: '⚠️ No selection',
      };
    }

    const document = editor.document;
    const selection = editor.selection;
    const selectedText = document.getText(selection);
    const fileName = document.fileName.split(/[\\/]/).pop() || 'unknown';

    return {
      type: 'selection',
      path: document.fileName,
      displayName: `${fileName} (L${selection.start.line + 1}-${selection.end.line + 1})`,
      content: selectedText,
      size: selectedText.length,
      language: document.languageId,
      lineRange: {
        start: selection.start.line + 1,
        end: selection.end.line + 1,
      },
    };
  }

  /**
   * Get file info without loading full content
   */
  private async getFileInfo(path: string): Promise<FileInfo | null> {
    try {
      return await this.fileOps.readFile(path);
    } catch (error) {
      return null;
    }
  }

  /**
   * Get display name from file path
   * Example: "src/auth/authManager.ts" → "authManager.ts"
   */
  private getDisplayName(path: string): string {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1];
  }

  /**
   * Fuzzy search scoring
   * Returns score between 0 and 1
   */
  private fuzzyScore(query: string, text: string): number {
    if (text.includes(query)) {
      // Exact substring match gets high score
      return 1.0;
    }

    // Check if all characters in query appear in order in text
    let queryIndex = 0;
    let textIndex = 0;
    let matches = 0;

    while (queryIndex < query.length && textIndex < text.length) {
      if (query[queryIndex] === text[textIndex]) {
        matches++;
        queryIndex++;
      }
      textIndex++;
    }

    if (matches === query.length) {
      // All characters found in order
      return 0.5 + (matches / text.length) * 0.5;
    }

    return 0;
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes}B`;
    } else if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)}KB`;
    } else {
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
  }

  /**
   * Check if file is too large (>50KB warning threshold)
   */
  isFileTooLarge(bytes: number): boolean {
    return bytes > 50 * 1024; // 50KB
  }

  /**
   * Generate context prompt from file references
   * This will be added to the system prompt
   */
  generateContextPrompt(references: FileReference[]): string {
    if (references.length === 0) {
      return '';
    }

    let prompt = '\n\n📎 **Referenced Files:**\n\n';

    for (const ref of references) {
      prompt += `**File: ${ref.path}**\n`;
      if (ref.language) {
        prompt += `Language: ${ref.language}\n`;
      }
      if (ref.size) {
        prompt += `Size: ${this.formatFileSize(ref.size)}\n`;
      }
      prompt += '```\n';
      prompt += ref.content || 'Error loading file';
      prompt += '\n```\n\n';
    }

    return prompt;
  }
}

