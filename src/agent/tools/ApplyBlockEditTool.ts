import { FileOperations } from '../fileOperations';
import { ContextManager } from '../contextManager';
import { ToolRegistry } from './ToolRegistry';
import { EditorEngine, MultiHunkEditRequest, HunkEdit } from '../editors/EditorEngine';
import { Logger } from '../../utils/Logger';

const log = Logger.getInstance();
const MAX_HUNKS_PER_FILE = 8;
const MAX_FILES_PER_CALL = 5;

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
    const previewOnly = !!args.preview_only;
    const mode: 'best-effort' | 'atomic' = args.mode === 'atomic' ? 'atomic' : 'best-effort';
    const fileEdits = Array.isArray(args.file_edits) ? args.file_edits : null;

    if (fileEdits && fileEdits.length > 0) {
      return this.executeMultiFile(fileEdits, mode, previewOnly);
    }

    const filePath = args.file_path || args.path;
    const edits: any[] = Array.isArray(args.edits) ? args.edits : [];

    if (!filePath || edits.length === 0) {
      return this.buildMissingParamsError();
    }
    const readCheck = this.ensureFileWasRead(filePath);
    if (!readCheck.ok) {
      return readCheck.error;
    }

    if (edits.length > MAX_HUNKS_PER_FILE) {
      return {
        success: false,
        error: `Too many edits provided. Maximum allowed is ${MAX_HUNKS_PER_FILE} hunks per file.`
      };
    }

    const request: MultiHunkEditRequest = this.buildRequest(filePath, edits, mode, previewOnly);

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
        await this.trackFileAccess(filePath);
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

  private async executeMultiFile(fileEdits: any[], mode: 'best-effort' | 'atomic', previewOnly: boolean): Promise<any> {
    if (fileEdits.length > MAX_FILES_PER_CALL) {
      return {
        success: false,
        error: `Too many files provided. Maximum allowed is ${MAX_FILES_PER_CALL} files per apply_block_edit call.`
      };
    }

    const perFileResults: Array<{ file_path: string; success: boolean; result: any }> = [];
    let filesApplied = 0;
    let filesFailed = 0;
    let appliedCount = 0;
    let failedCount = 0;

    for (const item of fileEdits) {
      const filePath = item?.file_path || item?.path;
      const edits = Array.isArray(item?.edits) ? item.edits : [];

      if (!filePath || edits.length === 0) {
        filesFailed++;
        perFileResults.push({
          file_path: filePath || 'unknown',
          success: false,
          result: this.buildMissingParamsError()
        });
        continue;
      }

      const readCheck = this.ensureFileWasRead(filePath);
      if (!readCheck.ok) {
        filesFailed++;
        perFileResults.push({
          file_path: filePath,
          success: false,
          result: readCheck.error
        });
        continue;
      }

      if (edits.length > MAX_HUNKS_PER_FILE) {
        filesFailed++;
        perFileResults.push({
          file_path: filePath,
          success: false,
          result: {
            success: false,
            error: `Too many edits for ${filePath}. Maximum allowed is ${MAX_HUNKS_PER_FILE} hunks per file.`
          }
        });
        continue;
      }

      const request = this.buildRequest(filePath, edits, mode, previewOnly);
      try {
        const result = await this.editorEngine.applyHunkEditsSafely(request);
        const success = result.success === true;

        if (success) {
          filesApplied++;
          appliedCount += Number(result.appliedCount || 0);
          if (!previewOnly && Number(result.appliedCount || 0) > 0) {
            await this.trackFileAccess(filePath);
          }
        } else {
          filesFailed++;
          failedCount += Number(result.failedCount || 0);
        }

        perFileResults.push({ file_path: filePath, success, result });
      } catch (error: any) {
        filesFailed++;
        perFileResults.push({
          file_path: filePath,
          success: false,
          result: {
            success: false,
            error: `Tool execution failed for ${filePath}: ${error.message}`
          }
        });
      }
    }

    return {
      success: filesFailed === 0,
      modeUsed: mode,
      fileMode: 'multi-file',
      previewOnly,
      filesApplied,
      filesFailed,
      appliedCount,
      failedCount,
      perFileResults
    };
  }

  private buildRequest(filePath: string, edits: any[], mode: 'best-effort' | 'atomic', previewOnly: boolean): MultiHunkEditRequest {
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

    return {
      filePath,
      mode,
      previewOnly,
      edits: hunkEdits
    };
  }

  private buildMissingParamsError() {
    return {
      success: false,
      appliedCount: 0,
      failedCount: 0,
      appliedHunks: [],
      failedHunks: [],
      previewDiffs: [],
      error: 'Missing required parameters: file_path and edits (must be non-empty array), or file_edits for v2 multi-file mode.'
    };
  }

  private async trackFileAccess(filePath: string): Promise<void> {
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

  private ensureFileWasRead(filePath: string): { ok: true } | { ok: false; error: any } {
    const workspaceRoot = this.fileOps.getWorkspaceRoot().replace(/\\/g, '/');
    const normalizedTarget = filePath.replace(/\\/g, '/');
    const relativeFromRoot = normalizedTarget.startsWith(workspaceRoot)
      ? normalizedTarget.slice(workspaceRoot.length).replace(/^\/+/, '')
      : normalizedTarget;
    const absoluteFromRoot = normalizedTarget.startsWith(workspaceRoot)
      ? normalizedTarget
      : `${workspaceRoot}/${relativeFromRoot}`.replace(/\/+/g, '/');

    if (
      this.contextManager.hasFileBeenRead(filePath) ||
      this.contextManager.hasFileBeenRead(relativeFromRoot) ||
      this.contextManager.hasFileBeenRead(absoluteFromRoot)
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      error: {
        success: false,
        error: `Read-before-edit required: You must call read_file on "${filePath}" before apply_block_edit.`,
        suggestedFix: `Call read_file({"path":"${filePath}"}) first, then retry apply_block_edit.`
      }
    };
  }
}
