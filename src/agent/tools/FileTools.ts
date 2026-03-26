// =====================================================
// File Tools - Basic file and search operations
// =====================================================

import { FileOperations } from '../fileOperations';
import { CodebaseIndexer } from '../CodebaseIndexer';
import { ContextManager } from '../contextManager';
import { RegexSearchService } from '../retrieval/RegexSearchService';
import { ToolRegistry } from './ToolRegistry';

export class FileTools {
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
    registry.register('list_files', this.listFiles.bind(this));
    registry.register('find_files', this.findFiles.bind(this));
    registry.register('regex_search', this.regexSearch.bind(this));
    // text_editor_20250728 and replace_file_content were removed in favor of safe_edit_file
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
}
