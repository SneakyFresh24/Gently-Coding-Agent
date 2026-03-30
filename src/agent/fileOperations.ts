/**
 * File Operations for Gently AI Coding Agent
 *
 * This module provides core file operations:
 * - Reading files and directories
 * - Writing new files
 * - Editing existing files
 * - Multi-file operations
 * - Code validation before writing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IValidationManager } from './validation/IValidationManager';

export interface FileInfo {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
}

export interface EditOperation {
  filePath: string;
  startLine: number;
  endLine: number;
  newContent: string;
}

export interface FileChange {
  type: 'create' | 'edit' | 'delete';
  filePath: string;
  content?: string;
  edit?: EditOperation;
}

/**
 * File Operations Manager
 */
export class FileOperations {
  private workspaceRoot: string;
  private validationManager?: IValidationManager;
  private validationEnabled: boolean = true;
  private messageCallback?: (message: any) => void;

  constructor(validationManager?: IValidationManager) {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.validationManager = validationManager;
  }

  /**
   * Set message callback for sending messages to webview
   */
  setMessageCallback(callback: (message: any) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Send validation message to webview
   */
  private sendValidationMessage(message: any): void {
    if (this.messageCallback) {
      this.messageCallback(message);
    }
  }

  /**
   * Set validation manager
   */
  setValidationManager(validationManager: IValidationManager): void {
    this.validationManager = validationManager;
  }

  /**
   * Enable/disable validation
   */
  setValidationEnabled(enabled: boolean): void {
    this.validationEnabled = enabled;
  }

  /**
   * Get workspace root path
   */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  getWorkspaceRoots(): string[] {
    const roots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) || [];
    if (roots.length > 0) return roots;
    return this.workspaceRoot ? [this.workspaceRoot] : [];
  }

  /**
   * List all files in workspace
   */
  async listFiles(pattern: string = '**/*', exclude?: string): Promise<string[]> {
    try {
      const excludePattern = exclude || '**/node_modules/**';
      const files = await vscode.workspace.findFiles(pattern, excludePattern);
      return files.map(uri => vscode.workspace.asRelativePath(uri));
    } catch (error) {
      console.error('Error listing files:', error);
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  /**
   * Read a single file
   */
  async readFile(filePath: string): Promise<FileInfo> {
    try {
      const absolutePath = this.resolveAbsolutePath(filePath);
      const uri = vscode.Uri.file(absolutePath);

      // Check if file exists
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        throw new Error(`File not found: ${filePath}`);
      }

      // Read file content
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf8');

      // Get file stats
      const stat = await vscode.workspace.fs.stat(uri);

      // Determine language
      const language = this.getLanguageFromPath(filePath);

      return {
        path: filePath,
        name: path.basename(filePath),
        content,
        language,
        size: stat.size
      };
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Read multiple files
   */
  async readFiles(filePaths: string[]): Promise<FileInfo[]> {
    const results = await Promise.allSettled(
      filePaths.map(filePath => this.readFile(filePath))
    );

    const files: FileInfo[] = [];
    const errors: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        files.push(result.value);
      } else {
        errors.push(`${filePaths[index]}: ${result.reason}`);
      }
    });

    if (errors.length > 0) {
      console.warn('Some files could not be read:', errors);
    }

    return files;
  }

  /**
   * Write a new file or overwrite existing (with validation)
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      // Validate code before writing (if validation is enabled)
      if (this.validationEnabled && this.validationManager) {
        const language = this.getLanguageFromPath(filePath);

        console.log(`[FileOperations] Validating ${filePath} (${language})...`);

        // Send validation start message
        this.sendValidationMessage({
          type: 'validationStart',
          file: filePath,
          language
        });

        const startTime = Date.now();

        const validationResult = await this.validationManager.validateWithRetry(
          content,
          language,
          filePath,
          (attempt, errors) => {
            console.log(`[FileOperations] Validation retry ${attempt}, errors: ${errors.length}`);

            // Send validation progress message
            this.sendValidationMessage({
              type: 'validationProgress',
              file: filePath,
              attempt,
              errorCount: errors.length
            });
          }
        );

        const duration = Date.now() - startTime;

        if (!validationResult.valid) {
          // Send validation failed message
          this.sendValidationMessage({
            type: 'validationFailed',
            file: filePath,
            errors: validationResult.result.errors,
            retries: validationResult.retries,
            duration
          });

          const errorMessages = validationResult.result.errors
            .map(e => `Line ${e.line}: ${e.message}`)
            .join('\n');

          // ❌ DON'T throw error - return it as tool result so LLM can see and fix
          throw new Error(
            `Code validation failed after ${validationResult.retries} retries:\n\n${errorMessages}\n\nPlease fix these errors and call write_file again with the corrected code.`
          );
        }

        // Send validation complete message
        this.sendValidationMessage({
          type: 'validationComplete',
          file: filePath,
          retries: validationResult.retries,
          duration
        });

        // Use the validated (potentially fixed) code
        content = validationResult.code;

        if (validationResult.retries > 0) {
          console.log(`[FileOperations] Code fixed after ${validationResult.retries} retries`);
        }
      }

      const absolutePath = this.resolveAbsolutePath(filePath);
      const uri = vscode.Uri.file(absolutePath);

      // Create directory if it doesn't exist
      const dirPath = path.dirname(absolutePath);
      const dirUri = vscode.Uri.file(dirPath);
      try {
        await vscode.workspace.fs.createDirectory(dirUri);
      } catch {
        // Directory might already exist
      }

      // Write file
      const buffer = Buffer.from(content, 'utf8');
      await vscode.workspace.fs.writeFile(uri, buffer);

      console.log(`[FileOperations] File written: ${filePath}`);
    } catch (error) {
      console.error(`[FileOperations] Error writing file ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Edit an existing file (line-based with validation)
   */
  async editFile(edit: EditOperation): Promise<void> {
    try {
      const absolutePath = this.resolveAbsolutePath(edit.filePath);
      const uri = vscode.Uri.file(absolutePath);

      // Open document
      const document = await vscode.workspace.openTextDocument(uri);

      // Calculate range
      const startLine = Math.max(0, edit.startLine);
      const endLine = Math.min(document.lineCount - 1, edit.endLine);

      // Build complete file content with the edit applied
      const lines = document.getText().split('\n');
      const beforeEdit = lines.slice(0, startLine).join('\n');
      const afterEdit = lines.slice(endLine + 1).join('\n');
      const newContent = [beforeEdit, edit.newContent, afterEdit]
        .filter(s => s.length > 0)
        .join('\n');

      // Validate the complete file after edit
      if (this.validationEnabled && this.validationManager) {
        const language = this.getLanguageFromPath(edit.filePath);

        console.log(`[FileOperations] Validating edit for ${edit.filePath}...`);

        // Send validation start message
        this.sendValidationMessage({
          type: 'validationStart',
          file: edit.filePath,
          language
        });

        const startTime = Date.now();

        const validationResult = await this.validationManager.validateWithRetry(
          newContent,
          language,
          edit.filePath,
          (attempt, errors) => {
            console.log(`[FileOperations] Edit validation retry ${attempt}, errors: ${errors.length}`);

            // Send validation progress message
            this.sendValidationMessage({
              type: 'validationProgress',
              file: edit.filePath,
              attempt,
              errorCount: errors.length
            });
          }
        );

        const duration = Date.now() - startTime;

        if (!validationResult.valid) {
          // Send validation failed message
          this.sendValidationMessage({
            type: 'validationFailed',
            file: edit.filePath,
            errors: validationResult.result.errors,
            retries: validationResult.retries,
            duration
          });

          const errorMessages = validationResult.result.errors
            .map(e => `Line ${e.line}: ${e.message}`)
            .join('\n');

          // ❌ DON'T throw error - return it as tool result so LLM can see and fix
          throw new Error(
            `Edit validation failed after ${validationResult.retries} retries:\n\n${errorMessages}\n\nPlease fix these errors and call edit_file again with the corrected code.`
          );
        }

        // Send validation complete message
        this.sendValidationMessage({
          type: 'validationComplete',
          file: edit.filePath,
          retries: validationResult.retries,
          duration
        });

        // If code was fixed, extract the edited portion
        if (validationResult.retries > 0) {
          console.log(`[FileOperations] Edit fixed after ${validationResult.retries} retries`);
          // Use the validated complete file content
          const validatedLines = validationResult.code.split('\n');
          edit.newContent = validatedLines.slice(startLine, startLine + edit.newContent.split('\n').length).join('\n');
        }
      }

      // Create edit
      const workspaceEdit = new vscode.WorkspaceEdit();

      const range = new vscode.Range(
        startLine,
        0,
        endLine,
        document.lineAt(endLine).text.length
      );

      workspaceEdit.replace(uri, range, edit.newContent);

      // Apply edit
      const success = await vscode.workspace.applyEdit(workspaceEdit);

      if (!success) {
        throw new Error('Failed to apply edit');
      }

      // Save document
      await document.save();

      console.log(`[FileOperations] File edited: ${edit.filePath} (lines ${startLine}-${endLine})`);
    } catch (error) {
      console.error(`[FileOperations] Error editing file ${edit.filePath}:`, error);
      throw error;
    }
  }

  /**
   * Delete a file
   */
  async deleteFile(filePath: string): Promise<void> {
    try {
      const absolutePath = this.resolveAbsolutePath(filePath);
      const uri = vscode.Uri.file(absolutePath);

      await vscode.workspace.fs.delete(uri);
      console.log(`File deleted: ${filePath}`);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
      throw new Error(`Failed to delete file: ${error}`);
    }
  }

  /**
   * Apply multiple file changes atomically
   */
  async applyChanges(changes: FileChange[]): Promise<void> {
    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const change of changes) {
      const absolutePath = this.resolveAbsolutePath(change.filePath);
      const uri = vscode.Uri.file(absolutePath);

      switch (change.type) {
        case 'create':
          if (change.content !== undefined) {
            workspaceEdit.createFile(uri, { overwrite: false });
            workspaceEdit.insert(uri, new vscode.Position(0, 0), change.content);
          }
          break;

        case 'edit':
          if (change.edit) {
            const document = await vscode.workspace.openTextDocument(uri);
            const range = new vscode.Range(
              change.edit.startLine,
              0,
              change.edit.endLine,
              document.lineAt(change.edit.endLine).text.length
            );
            workspaceEdit.replace(uri, range, change.edit.newContent);
          }
          break;

        case 'delete':
          workspaceEdit.deleteFile(uri);
          break;
      }
    }

    const success = await vscode.workspace.applyEdit(workspaceEdit);

    if (!success) {
      throw new Error('Failed to apply changes');
    }

    console.log(`Applied ${changes.length} file changes`);
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      const absolutePath = this.resolveAbsolutePath(filePath);
      const uri = vscode.Uri.file(absolutePath);
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get file content as string (convenience method)
   */
  async getFileContent(filePath: string): Promise<string> {
    const fileInfo = await this.readFile(filePath);
    return fileInfo.content;
  }

  /**
   * Resolve relative path to absolute
   */
  private resolveAbsolutePath(filePath: string): string {
    const roots = this.getWorkspaceRoots();
    if (!roots.length) {
      throw new Error('Path security error: no workspace root available');
    }

    const raw = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(roots[0], filePath);

    const canonicalRoots = roots
      .map((root) => this.safeRealpath(root) || path.resolve(root))
      .filter((root) => root.length > 0);

    const canonicalTarget = this.resolveCanonicalPath(raw);
    const allowed = canonicalRoots.some((root) => this.isWithinRoot(canonicalTarget, root));
    if (!allowed) {
      throw new Error(`Path outside workspace boundaries: ${filePath}`);
    }
    return canonicalTarget;
  }

  private resolveCanonicalPath(targetPath: string): string {
    const normalizedTarget = path.resolve(targetPath);
    const canonicalTarget = this.safeRealpath(normalizedTarget);
    if (canonicalTarget) return canonicalTarget;

    let cursor = path.dirname(normalizedTarget);
    let depth = 0;
    while (depth < 128) {
      const canonicalParent = this.safeRealpath(cursor);
      if (canonicalParent) {
        const relativeFromExisting = path.relative(cursor, normalizedTarget);
        return path.resolve(canonicalParent, relativeFromExisting);
      }
      const next = path.dirname(cursor);
      if (next === cursor) {
        throw new Error(`Path resolution failed (unresolvable or circular symlink): ${targetPath}`);
      }
      cursor = next;
      depth += 1;
    }
    throw new Error(`Path resolution failed (depth exceeded): ${targetPath}`);
  }

  private safeRealpath(targetPath: string): string | undefined {
    try {
      if ((fs.realpathSync as any).native) {
        return (fs.realpathSync as any).native(targetPath);
      }
      return fs.realpathSync(targetPath);
    } catch (error: any) {
      const code = error?.code;
      if (code === 'ENOENT') {
        return undefined;
      }
      if (code === 'ELOOP') {
        throw new Error(`Path resolution failed (circular symlink): ${targetPath}`);
      }
      throw error;
    }
  }

  private isWithinRoot(candidatePath: string, rootPath: string): boolean {
    const normalizedCandidate = path.resolve(candidatePath);
    const normalizedRoot = path.resolve(rootPath);

    if (process.platform === 'win32') {
      const candidateLower = normalizedCandidate.toLowerCase();
      const rootLower = normalizedRoot.toLowerCase();
      return candidateLower === rootLower || candidateLower.startsWith(`${rootLower}${path.sep}`);
    }

    return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
  }

  /**
   * Determine language from file extension
   */
  public getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      // JavaScript/TypeScript
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      // Web
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less',
      '.vue': 'vue',
      '.svelte': 'svelte',
      // Python
      '.py': 'python',
      '.pyw': 'python',
      // Java/Kotlin/Scala
      '.java': 'java',
      '.kt': 'kotlin',
      '.scala': 'scala',
      // C/C++
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.c': 'c',
      '.h': 'c',
      '.hpp': 'cpp',
      // C#
      '.cs': 'csharp',
      // Go
      '.go': 'go',
      // Rust
      '.rs': 'rust',
      // Ruby
      '.rb': 'ruby',
      // PHP
      '.php': 'php',
      // Swift
      '.swift': 'swift',
      // Other
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      '.txt': 'plaintext',
      '.sql': 'sql',
      '.sh': 'shellscript',
      '.bat': 'bat',
      '.ps1': 'powershell'
    };

    return languageMap[ext] || 'plaintext';
  }
}
