import { FileOperations } from '../fileOperations';
import { ContextManager } from '../contextManager';
import { ToolRegistry } from './ToolRegistry';
import { EditorEngine, MultiHunkEditRequest, HunkEdit } from '../editors/EditorEngine';
import { Logger } from '../../utils/Logger';

const log = Logger.getInstance();

export class ApplyBlockEditTool {
  constructor(
    private fileOps: FileOperations,
    private contextManager: ContextManager,
    private editorEngine: EditorEngine
  ) {}

  registerTools(registry: ToolRegistry): void {
    registry.register('apply_block_edit', this.execute.bind(this));
  }

  async execute(args: any): Promise<any> {
    const filePath = args.file_path || args.path;
    const previewOnly = !!args.preview_only;
    const mode = args.mode || 'best-effort';
    const edits: any[] = args.edits || [];

    if (!filePath || edits.length === 0) {
      return {
        success: false,
        appliedCount: 0,
        failedCount: 0,
        appliedHunks: [],
        failedHunks: [],
        previewDiffs: [],
        error: "Missing required parameters: file_path and edits (must be non-empty array)"
      };
    }

    if (edits.length > 8) {
      return {
        success: false,
        error: "Too many edits provided. Maximum allowed is 8 hunks per tool call to prevent context overload."
      };
    }

    // Map the incoming edits to our internal interface
    const hunkEdits: HunkEdit[] = edits.map((edit, index) => ({
      id: edit.id || `hunk-${index}`,
      oldContent: edit.old_content,
      newContent: edit.new_content,
      startLineHint: edit.start_line_hint,
      endLineHint: edit.end_line_hint,
      contextBefore: edit.context_before,
      contextAfter: edit.context_after,
      reason: edit.reason || 'No reason provided'
    }));

    const request: MultiHunkEditRequest = {
      filePath,
      mode,
      previewOnly,
      edits: hunkEdits
    };

    try {
      if (previewOnly) {
        log.info(`Performing preview for ${filePath}`);
        return await this.editorEngine.applyHunkEditsSafely(request);
      }

      // Full apply mode
      log.info(`Applying block edits to ${filePath} (mode: ${mode})`);

      // Apply via EditorEngine
      const result = await this.editorEngine.applyHunkEditsSafely(request);

      if (result.success && result.appliedCount > 0) {
        // Track the successful file modification
        try {
          const workspaceRoot = this.fileOps.getWorkspaceRoot();
          const absolutePath = filePath.startsWith(workspaceRoot) ? filePath : `${workspaceRoot}/${filePath}`;
          
          const fileInfo = await this.fileOps.readFile(absolutePath);
          this.contextManager.trackFileAccess(
            fileInfo.path,
            fileInfo.content,
            fileInfo.language,
            fileInfo.size
          );
        } catch (e) {
          log.debug(`Failed to track file access after edit: ${e}`);
        }
      }

      return result;

    } catch (error: any) {
      log.error(`Failed to apply block edits: ${error.message}`);
      return {
        success: false,
        error: `Tool execution failed: ${error.message}`
      };
    }
  }
}
