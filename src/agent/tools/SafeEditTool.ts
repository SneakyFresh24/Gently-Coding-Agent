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
      const targetPath = args.file_path || args.path;
      const workspaceRoot = this.fileOps.getWorkspaceRoot();
      const normalizedTarget = targetPath.replace(/\\/g, '/');
      const relativeFromRoot = normalizedTarget.startsWith(workspaceRoot.replace(/\\/g, '/'))
        ? normalizedTarget.slice(workspaceRoot.replace(/\\/g, '/').length).replace(/^\/+/, '')
        : normalizedTarget;
      const absoluteFromRoot = normalizedTarget.startsWith(workspaceRoot.replace(/\\/g, '/'))
        ? normalizedTarget
        : `${workspaceRoot.replace(/\\/g, '/')}/${relativeFromRoot}`.replace(/\/+/g, '/');

      if (
        !this.contextManager.hasFileBeenRead(targetPath) &&
        !this.contextManager.hasFileBeenRead(relativeFromRoot) &&
        !this.contextManager.hasFileBeenRead(absoluteFromRoot)
      ) {
        return {
          success: false,
          error: `Read-before-edit required: You must call read_file on "${targetPath}" before safe_edit_file.`,
          suggestedFix: `Call read_file({"path":"${targetPath}"}) first, then retry safe_edit_file.`
        };
      }

      const result = await this.editorEngine.executeEdit({
        filePath: targetPath,
        anchorLine: args.anchor_line,
        newContent: args.new_content,
        endAnchor: args.end_anchor,
        lineNumberHint: args.line_number_hint,
        startLine: args.start_line,
        endLine: args.end_line,
        symbolName: args.symbol_name,
        preview: args.preview,
        allowFuzzy: args.allow_fuzzy === true
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

