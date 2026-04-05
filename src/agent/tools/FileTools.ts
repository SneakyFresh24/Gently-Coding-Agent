// =====================================================
// File Tools - Basic file and search operations
// =====================================================

import { FileOperations } from '../fileOperations';
import { CodebaseIndexer } from '../CodebaseIndexer';
import { ContextManager } from '../contextManager';
import { RegexSearchService } from '../retrieval/RegexSearchService';
import { ToolRegistry } from './ToolRegistry';
import { createHash } from 'crypto';

export class FileTools {
  private static readonly CHUNK_SESSION_TTL_MS = 10 * 60 * 1000;
  private static readonly MAX_CHUNK_SESSIONS = 200;
  private readonly chunkedWriteSessions = new Map<
    string,
    {
      path: string;
      chunkCount: number;
      checksum?: string;
      chunks: Map<number, string>;
      createdAt: number;
      lastUpdatedAt: number;
    }
  >();

  constructor(
    private fileOps: FileOperations,
    private indexer: CodebaseIndexer,
    private contextManager: ContextManager,
    private regexSearchService: RegexSearchService
  ) { }

  /**
   * Register all file-related tools
   */
  registerTools(registry: ToolRegistry): void {
    registry.register('read_file', this.readFile.bind(this));
    registry.register('write_file', this.writeFile.bind(this));
    registry.register('write_file_chunk', this.writeFileChunk.bind(this));
    registry.register('list_files', this.listFiles.bind(this));
    registry.register('find_files', this.findFiles.bind(this));
    registry.register('regex_search', this.regexSearch.bind(this));
    // text_editor_20250728 and replace_file_content were removed in favor of safe_edit_file
  }

  private async writeFileChunk(params: any): Promise<any> {
    try {
      const now = Date.now();
      this.cleanupChunkedWriteSessions(now);
      const filePath = String(params.path || params.file_path || '').trim();
      const writeSessionId = String(params.writeSessionId || '').trim();
      const chunkIndex = Number(params.chunkIndex);
      const chunkCount = Number(params.chunkCount);
      const chunkContent = typeof params.chunkContent === 'string' ? params.chunkContent : '';
      const checksum = typeof params.checksum === 'string' ? params.checksum : undefined;

      if (!filePath || !writeSessionId) {
        return {
          success: false,
          message: 'write_file_chunk requires path and writeSessionId.'
        };
      }
      if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
        return {
          success: false,
          message: `Invalid chunkIndex for ${writeSessionId}: ${chunkIndex}`
        };
      }
      if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
        return {
          success: false,
          message: `Invalid chunkCount for ${writeSessionId}: ${chunkCount}`
        };
      }
      if (chunkIndex >= chunkCount) {
        return {
          success: false,
          message: `chunkIndex (${chunkIndex}) must be smaller than chunkCount (${chunkCount}).`
        };
      }

      const existing = this.chunkedWriteSessions.get(writeSessionId);
      if (!existing && chunkIndex !== 0) {
        return {
          success: false,
          message: `Unknown or expired writeSessionId "${writeSessionId}". Restart chunked write from chunkIndex 0.`
        };
      }
      const session = existing || {
        path: filePath,
        chunkCount,
        checksum,
        chunks: new Map<number, string>(),
        createdAt: now,
        lastUpdatedAt: now
      };

      if (session.path !== filePath) {
        return {
          success: false,
          message: `writeSessionId "${writeSessionId}" is already bound to "${session.path}", not "${filePath}".`
        };
      }
      if (session.chunkCount !== chunkCount) {
        return {
          success: false,
          message: `chunkCount mismatch for writeSessionId "${writeSessionId}". Expected ${session.chunkCount}, received ${chunkCount}.`
        };
      }

      session.chunks.set(chunkIndex, chunkContent);
      session.lastUpdatedAt = now;
      if (checksum && !session.checksum) {
        session.checksum = checksum;
      }
      this.chunkedWriteSessions.set(writeSessionId, session);
      this.enforceChunkedSessionLimit(now);

      if (session.chunks.size < session.chunkCount) {
        return {
          success: true,
          pending: true,
          writeSessionId,
          chunkIndex,
          chunkCount,
          receivedChunks: session.chunks.size
        };
      }

      const content = Array.from({ length: session.chunkCount })
        .map((_, index) => session.chunks.get(index) || '')
        .join('');

      if (session.checksum) {
        const calculated = createHash('sha256').update(content).digest('hex');
        if (calculated !== session.checksum) {
          this.chunkedWriteSessions.delete(writeSessionId);
          return {
            success: false,
            message: `Checksum mismatch for writeSessionId "${writeSessionId}".`
          };
        }
      }

      await this.fileOps.writeFile(filePath, content);
      this.contextManager.trackFileAccess(
        filePath,
        content,
        this.fileOps.getLanguageFromPath(filePath),
        content.length
      );
      this.chunkedWriteSessions.delete(writeSessionId);

      return {
        success: true,
        path: filePath,
        writeSessionId,
        chunkCount,
        bytes: content.length,
        message: `Chunked write completed for ${filePath}.`
      };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  public dispose(): void {
    this.chunkedWriteSessions.clear();
  }

  private async readFile(params: any): Promise<any> {
    try {
      const targetPath = params.path || params.file_path;
      const fileInfo = await this.fileOps.readFile(targetPath);
      // Track access
      this.contextManager.trackFileAccess(
        fileInfo.path,
        fileInfo.content,
        fileInfo.language,
        fileInfo.size
      );
      this.contextManager.markFileRead(fileInfo.path);
      return fileInfo;
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  private async writeFile(params: any): Promise<any> {
    try {
      const filePath = params.path || params.file_path;
      await this.fileOps.writeFile(filePath, params.content);
      // Track access
      this.contextManager.trackFileAccess(
        filePath,
        params.content,
        this.fileOps.getLanguageFromPath(filePath),
        params.content.length
      );

      // Detect package.json changes → hint the LLM to run npm install
      const isPackageJson = filePath.replace(/\\/g, '/').endsWith('package.json');
      const hint = isPackageJson
        ? '⚠️ package.json was modified. You should run `run_command` with "npm install" (or pnpm/bun install) to install updated dependencies.'
        : undefined;

      return {
        success: true,
        path: filePath,
        message: `File ${filePath} written successfully.`,
        ...(hint ? { hint } : {})
      };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  private async listFiles(params: any): Promise<any> {
    try {
      const files = await this.fileOps.listFiles(params.pattern || '**/*');
      return {
        success: true,
        files: files
      };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  private async findFiles(params: any): Promise<any> {
    try {
      const results = await this.indexer.findRelevantFilesHybrid(params.query, params.max_results || 10);
      return {
        success: true,
        results: results.map(r => ({
          file_path: r.filePath,
          score: r.score,
          reason: r.reason
        }))
      };
    } catch (error) {
      return { success: false, message: String(error) };
    }
  }

  private async regexSearch(params: any): Promise<any> {
    try {
      const result = await this.regexSearchService.search({
        pattern: params.pattern,
        path_glob: params.path_glob,
        flags: params.flags,
        case_sensitive: params.case_sensitive,
        multiline: params.multiline,
        max_results: params.max_results,
        context_lines: params.context_lines
      });

      return result;
    } catch (error) {
      return {
        success: false,
        matches: [],
        metadata: {
          source: 'fallback',
          engineUsed: 'rg',
          fallbackReason: 'tool_error',
          candidateCount: 0,
          verifiedFiles: 0,
          timings: {},
          indexState: 'empty'
        },
        message: String(error)
      };
    }
  }

  private cleanupChunkedWriteSessions(now: number): void {
    for (const [writeSessionId, session] of this.chunkedWriteSessions.entries()) {
      if (now - session.lastUpdatedAt > FileTools.CHUNK_SESSION_TTL_MS) {
        this.chunkedWriteSessions.delete(writeSessionId);
      }
    }
  }

  private enforceChunkedSessionLimit(now: number): void {
    if (this.chunkedWriteSessions.size <= FileTools.MAX_CHUNK_SESSIONS) {
      return;
    }

    const ordered = Array.from(this.chunkedWriteSessions.entries()).sort((left, right) => {
      const leftTs = left[1].lastUpdatedAt || left[1].createdAt;
      const rightTs = right[1].lastUpdatedAt || right[1].createdAt;
      return leftTs - rightTs;
    });

    while (this.chunkedWriteSessions.size > FileTools.MAX_CHUNK_SESSIONS && ordered.length > 0) {
      const candidate = ordered.shift();
      if (!candidate) break;
      const [sessionId, session] = candidate;
      // Prefer removing stale sessions first when over limit.
      const isStale = now - session.lastUpdatedAt > FileTools.CHUNK_SESSION_TTL_MS;
      if (isStale || this.chunkedWriteSessions.size > FileTools.MAX_CHUNK_SESSIONS) {
        this.chunkedWriteSessions.delete(sessionId);
      }
    }
  }
}
