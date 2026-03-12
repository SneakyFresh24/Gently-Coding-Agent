import { FileOperations } from '../fileOperations';
import { CodebaseIndexer } from '../CodebaseIndexer';
import { ContextManager } from '../contextManager';
import { ToolRegistry } from './ToolRegistry';
import { EditorEngine } from '../editors/EditorEngine';

/**
 * SafeEditTool - Evolution Level 4
 * Now acts as a thin wrapper around the Intelligent EditorEngine.
 */
export class SafeEditTool {
  constructor(
    private fileOps: FileOperations,
    private contextManager: ContextManager,
    private editorEngine: EditorEngine
  ) { }

  /**
   * Register the safe edit tool
   */
  registerTools(registry: ToolRegistry): void {
    registry.register('safe_edit_file', this.execute.bind(this));
  }

  /**
   * Execute the safe edit via EditorEngine
   */
  async execute(args: any): Promise<any> {
    try {
      const result = await this.editorEngine.executeEdit({
        filePath: args.file_path || args.path,
        anchorLine: args.anchor_line,
        newContent: args.new_content,
        endAnchor: args.end_anchor,
        lineNumberHint: args.line_number_hint,
        startLine: args.start_line,
        endLine: args.end_line,
        symbolName: args.symbol_name,
        preview: args.preview
      });

      if (result.success && result.path) {
        // Track in context manager after successful edit
        try {
          const fileInfo = await this.fileOps.readFile(result.path);
          this.contextManager.trackFileAccess(
            fileInfo.path,
            fileInfo.content,
            fileInfo.language,
            fileInfo.size
          );
        } catch (e) {
          // Non-critical
        }

        // Detect package.json edits → hint the LLM to run npm install
        const isPackageJson = result.path.replace(/\\/g, '/').endsWith('package.json');
        if (isPackageJson) {
          result.hint = '⚠️ package.json was modified. You should run `run_command` with "npm install" (or pnpm/bun install) to install updated dependencies.';
        }
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: `Tool execution failed: ${error.message}`
      };
    }
  }
}

