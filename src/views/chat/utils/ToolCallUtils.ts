// =====================================================
// Tool Call Utilities
// =====================================================

import { repairAndParseJSON, createLLMErrorMessage } from '../../../utils/jsonRepair';
import { createHash } from 'crypto';
import { ToolResultErrorCodes, ToolResultErrorCode } from '../toolcall/ToolResultErrorCodes';

export interface ToolCallValidationResult {
  validToolCalls: any[];
  invalidToolCalls: Array<{ toolCall: any; index: number; error: string; code?: ToolResultErrorCode; details?: Record<string, unknown> }>;
  warnings: string[];
}

export class ToolCallUtils {
  private static readonly MAX_TOOL_ARG_CHARS = 50_000;
  /**
   * Validate and repair tool calls
   */
  static validateAndRepairToolCalls(toolCalls: any[], options?: { model?: string }): ToolCallValidationResult {
    const validToolCalls: any[] = [];
    const invalidToolCalls: any[] = [];
    const warnings: string[] = [];
    const modelTag = this.formatModelTag(options?.model);
    const seenIds = new Map<string, number>();

    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];

      try {
        if (!toolCall.function || !toolCall.function.name || (typeof toolCall.function.name === 'string' && toolCall.function.name.trim() === '')) {
          // Log the actual structure for debugging
          console.error(`[PARALLEL] Tool call ${index} has unexpected structure:`, JSON.stringify(toolCall, null, 2));

          // Normalize flattened tool call structure
          if (typeof toolCall.name === 'string' && toolCall.name.trim() !== '' && toolCall.arguments) {
            console.log(`[PARALLEL] Normalizing flattened tool call: ${toolCall.name}`);
            toolCall.function = {
              name: toolCall.name.trim(),
              arguments: toolCall.arguments
            };
          } else if (typeof toolCall.function === 'string') {
            // Handle case where function is a string
            console.log(`[PARALLEL] Normalizing string function tool call: ${toolCall.function}`);
            toolCall.function = { 
              name: toolCall.function, 
              arguments: toolCall.arguments || '{}' 
            };
          } else {
            const rawArguments = typeof toolCall.function?.arguments === 'string'
              ? toolCall.function.arguments
              : typeof toolCall.arguments === 'string'
                ? toolCall.arguments
                : '{}';
            const parsedArguments = this.tryParseArguments(rawArguments);
            if (parsedArguments && typeof parsedArguments === 'object' && parsedArguments.task_progress) {
              const progressText = String(parsedArguments.task_progress);
              const warning = `[${modelTag}] internal_progress_skipped: task_progress="${progressText.substring(0, 50)}..."`;
              console.warn(warning);
              warnings.push(warning);
              continue;
            }

            const warning = `[${modelTag}] anonymous_tool_call_skipped`;
            console.warn(`[PARALLEL] Tool call ${index} missing function or name - skipped`);
            warnings.push(warning);
            continue;
          }
        }

        toolCall.function.name = String(toolCall.function.name || '').trim();
        if (!toolCall.function.name) {
          const warning = `[${modelTag}] anonymous_tool_call_skipped`;
          console.warn(warning);
          warnings.push(warning);
          continue;
        }

        if (typeof toolCall.function.arguments !== 'string') {
          toolCall.function.arguments = JSON.stringify(toolCall.function.arguments || {});
        }

        // FIX: Normalize empty arguments for parameterless tools (list_files, analyze_project_structure, recall_memories, etc.)
        if (!toolCall.function.arguments || toolCall.function.arguments.trim() === '' || toolCall.function.arguments.trim() === '{}') {
          toolCall.function.arguments = '{}';
          console.log(`[PARALLEL] ✅ Normalized empty arguments for tool: ${toolCall.function.name}`);
        }

        // 1) Repair malformed JSON arguments
        const repairResult = repairAndParseJSON(toolCall.function.arguments);

        if (!repairResult.success) {
          console.error(`[PARALLEL] Tool call ${index} has invalid JSON arguments, skipping:`, repairResult);
          console.error(`[PARALLEL] Tool name: ${toolCall.function.name}`);
          console.error(`[PARALLEL] Arguments (first 500 chars):`, toolCall.function.arguments.substring(0, 500));

          const errorMsg = createLLMErrorMessage(repairResult, toolCall.function.name);
          invalidToolCalls.push({
            toolCall,
            index,
            error: errorMsg,
            code: repairResult.errorCode === 'TOOL_ARGS_TRUNCATED'
              ? ToolResultErrorCodes.TOOL_ARGS_TRUNCATED
              : ToolResultErrorCodes.JSON_PARSE_ERROR,
            details: {
              truncationReason: repairResult.truncationReason,
              partialFields: repairResult.partialFields || {},
              rawPreview: repairResult.rawPreview,
              charCount: repairResult.charCount
            }
          });
          continue;
        }

        // 2) Apply model-specific content fixes on repaired args
        const repairedArgs = repairResult.repaired;
        if (!repairedArgs || typeof repairedArgs !== 'object' || Array.isArray(repairedArgs)) {
          invalidToolCalls.push({
            toolCall,
            index,
            error: `Tool call "${toolCall.function.name}" must contain an object JSON payload.`
          });
          continue;
        }

        const fixedArgs = this.applyModelContentFixesToArgs(repairedArgs, options?.model);

        // 3) Final argument serialization for execution
        toolCall.function.arguments = JSON.stringify(fixedArgs);

        // If repair was needed, emit diagnostics
        if (repairResult.repairActions && repairResult.repairActions.length > 0) {
          console.log(`[PARALLEL] ✅ Tool call ${index} JSON repaired:`, repairResult.repairActions);
        }

        if (this.isMistralModel(options?.model)) {
          const originalId = typeof toolCall.id === 'string' && toolCall.id.trim() !== ''
            ? toolCall.id.trim()
            : `tool_${index + 1}`;
          const normalizedBaseId = this.normalizeToolCallIdForMistral(originalId);
          let normalizedId = normalizedBaseId;
          let duplicateSuffix = 1;
          while (seenIds.has(normalizedId)) {
            duplicateSuffix += 1;
            normalizedId = this.buildUniqueMistralId(normalizedBaseId, duplicateSuffix);
          }
          seenIds.set(normalizedId, 1);
          if (normalizedId !== originalId) {
            const warning = `[${modelTag}] mistral_tool_call_id_normalized: "${originalId}" -> "${normalizedId}"`;
            warnings.push(warning);
          }
          toolCall.id = normalizedId;
        } else if (typeof toolCall.id === 'string' && toolCall.id.trim() !== '') {
          const originalId = toolCall.id.trim();
          const currentCount = seenIds.get(originalId) || 0;
          if (currentCount > 0) {
            const newId = `${originalId}_${currentCount + 1}`;
            const warning = `[${modelTag}] duplicate_tool_call_id_renamed: "${originalId}" -> "${newId}"`;
            console.warn(warning);
            warnings.push(warning);
            toolCall.id = newId;
          } else {
            toolCall.id = originalId;
          }
          seenIds.set(originalId, currentCount + 1);
        }

        const oversize = this.getOversizeViolation(
          toolCall.function.name,
          (fixedArgs && typeof fixedArgs === 'object' && !Array.isArray(fixedArgs))
            ? fixedArgs as Record<string, unknown>
            : {}
        );
        if (oversize) {
          invalidToolCalls.push({
            toolCall,
            index,
            error: oversize.message,
            code: ToolResultErrorCodes.TOOL_ARGS_TOO_LARGE,
            details: oversize.details
          });
          continue;
        }

        validToolCalls.push(toolCall);
      } catch (error: any) {
        console.error(`[PARALLEL] Tool call ${index} validation error:`, error);
        invalidToolCalls.push({
          toolCall,
          index,
          error: error.message,
          code: ToolResultErrorCodes.JSON_PARSE_ERROR
        });
      }
    }

    return { validToolCalls, invalidToolCalls, warnings };
  }

  private static getOversizeViolation(
    toolName: string,
    args: Record<string, unknown>
  ): { message: string; details: Record<string, unknown> } | null {
    const normalized = (toolName || '').toLowerCase();
    if (normalized === 'write_file' && typeof args.content === 'string') {
      const size = args.content.length;
      if (size > this.MAX_TOOL_ARG_CHARS) {
        return {
          message: `write_file.content exceeds ${this.MAX_TOOL_ARG_CHARS} characters (actual: ${size}).`,
          details: {
            field: 'content',
            actualSize: size,
            maxSize: this.MAX_TOOL_ARG_CHARS,
            path: typeof args.path === 'string' ? args.path : (typeof args.file_path === 'string' ? args.file_path : undefined)
          }
        };
      }
    }

    if (normalized === 'safe_edit_file' && typeof args.new_content === 'string') {
      const size = args.new_content.length;
      if (size > this.MAX_TOOL_ARG_CHARS) {
        return {
          message: `safe_edit_file.new_content exceeds ${this.MAX_TOOL_ARG_CHARS} characters (actual: ${size}).`,
          details: {
            field: 'new_content',
            actualSize: size,
            maxSize: this.MAX_TOOL_ARG_CHARS,
            path: typeof args.file_path === 'string' ? args.file_path : (typeof args.path === 'string' ? args.path : undefined)
          }
        };
      }
    }

    return null;
  }

  private static formatModelTag(model?: string): string {
    return `model=${model && model.trim() !== '' ? model : 'unknown'}`;
  }

  private static tryParseArguments(raw: string): any | null {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  static applyModelContentFixes(content: string, modelId?: string, _filePath?: string): string {
    if (typeof content !== 'string') return content;
    let fixed = content;
    const model = (modelId || '').toLowerCase();

    if (model.includes('deepseek')) {
      fixed = fixed.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    }

    if (model.includes('llama') || model.includes('gemini')) {
      fixed = fixed.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    if (fixed.startsWith('```')) {
      fixed = fixed.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
    }

    return fixed;
  }

  private static applyModelContentFixesToArgs(value: unknown, modelId?: string, keyHint?: string): unknown {
    if (typeof value === 'string') {
      return this.isContentLikeKey(keyHint)
        ? this.applyModelContentFixes(value, modelId)
        : value;
    }

    if (Array.isArray(value)) {
      return value.map((entry) => this.applyModelContentFixesToArgs(entry, modelId, keyHint));
    }

    if (value && typeof value === 'object') {
      const fixed: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        fixed[key] = this.applyModelContentFixesToArgs(entry, modelId, key);
      }
      return fixed;
    }

    return value;
  }

  private static isContentLikeKey(key?: string): boolean {
    if (!key) return false;
    const normalized = key.toLowerCase();
    const contentLikeKeys = new Set([
      'content',
      'text',
      'diff',
      'patch',
      'oldtext',
      'newtext',
      'old_text',
      'new_text',
      'replacement',
      'search',
      'replace',
      'code',
      'snippet'
    ]);
    return contentLikeKeys.has(normalized);
  }

  private static isMistralModel(model?: string): boolean {
    return (model || '').toLowerCase().includes('mistral');
  }

  private static normalizeToolCallIdForMistral(id: string): string {
    const alphanumeric = (id || '').replace(/[^a-zA-Z0-9]/g, '');
    return (alphanumeric || 'toolcall0').slice(0, 9).padEnd(9, '0');
  }

  private static buildUniqueMistralId(baseId: string, sequence: number): string {
    const suffix = createHash('sha256').update(`${baseId}:${sequence}`).digest('hex').slice(0, 3);
    const prefix = baseId.slice(0, 6).padEnd(6, '0');
    return `${prefix}${suffix}`.slice(0, 9);
  }

  /**
   * Repair and parse JSON
   */
  static repairAndParseJSON(jsonString: string) {
    return repairAndParseJSON(jsonString);
  }

  /**
   * Extract file paths from tool calls
   */
  static extractFilePathsFromToolCalls(toolCalls: any[]): Set<string> {
    const filePaths = new Set<string>();

    for (const toolCall of toolCalls) {
      try {
        const toolName = toolCall.function.name;

        // Use JSON repair system
        const repairResult = this.repairAndParseJSON(toolCall.function.arguments);
        if (!repairResult.success) {
          continue;
        }

        const toolArgs = repairResult.repaired;

        // Extract file paths from tool arguments
        if (toolArgs.path) {
          filePaths.add(toolArgs.path);
        }
        if (toolArgs.file_path) {
          filePaths.add(toolArgs.file_path);
        }
        if (toolArgs.filePath) {
          filePaths.add(toolArgs.filePath);
        }
        if (toolArgs.changes && Array.isArray(toolArgs.changes)) {
          toolArgs.changes.forEach((change: any) => {
            if (change.path) {
              filePaths.add(change.path);
            }
          });
        }
      } catch (parseError) {
        console.error(`[ToolCallUtils] Error parsing tool arguments for checkpoint:`, parseError);
        // Continue with other tool calls
      }
    }

    return filePaths;
  }

  /**
   * Get user-friendly thinking message for tool execution
   */
  static getThinkingMessage(toolName: string, toolArgs: any): string {
    // Support both 'path' and 'file_path' parameter names
    const filePath = toolArgs.path || toolArgs.file_path;

    switch (toolName) {
      case 'read_file':
        return `Reading file ${filePath || 'unknown'}...`;
      case 'write_file':
        return `Creating file ${filePath || 'unknown'}...`;
      case 'edit_file':
        return `Editing file ${filePath || 'unknown'}...`;
      case 'safe_edit_file':
        return `Editing file ${filePath || toolArgs.file_path || 'unknown'}...`;
      case 'apply_block_edit':
        return `Applying edits to ${toolArgs.file_path || 'unknown'}...`;
      case 'list_files':
        return `Listing files...`;
      case 'find_files':
        return `Suche nach "${toolArgs.query}"...`;
      case 'regex_search':
        return `Regex-Suche nach "${toolArgs.pattern}"...`;
      case 'get_context':
        return `Hole Workspace-Kontext...`;
      case 'search_codebase':
        return `Durchsuche Codebase...`;
      case 'analyze_project_structure':
        return `Analysiere Projektstruktur...`;
      case 'check_dev_server':
        return `Prüfe Entwicklungsserver...`;
      case 'run_command':
        return `Executing command: ${toolArgs.command}`;
      // Memory tools
      case 'remember':
        return `Saving memory...`;
      case 'recall_memories':
        return `Recalling memories...`;
      case 'update_memory':
        return `Updating memory...`;
      case 'deprecate_memory':
        return `Archiving memory...`;
      case 'check_memory_conflicts':
        return `Prüfe auf Konflikte...`;
      case 'record_correction':
        return `Protokolliere Korrektur...`;
      // Pattern suggestions
      case 'check_pattern_suggestions':
        return `Prüfe Muster-Vorschläge...`;
      case 'accept_pattern_suggestion':
        return `Nehme Muster an...`;
      case 'reject_pattern_suggestion':
        return `Lehne Muster ab...`;
      // Checkpoints
      case 'create_checkpoint':
        return `Erstelle Checkpoint...`;
      case 'restore_checkpoint':
        return `Stelle Checkpoint wieder her...`;
      case 'list_checkpoints':
        return `Liste Checkpoints auf...`;
      // Planning
      case 'create_plan':
        return `Erstelle Plan...`;
      case 'execute_plan':
        return `Führe Plan aus...`;
      default:
        return `Fuehre ${toolName} aus...`;
    }
  }

  /**
   * Generate tool completion comment for UI
   */
  static generateToolCompletionComment(toolName: string, toolArgs: any, result: any): any {
    const comment: any = {
      text: '',
      type: 'success',
      details: []
    };

    switch (toolName) {
      case 'read_file':
        comment.text = 'Read file';
        comment.details.push({
          type: 'file',
          path: toolArgs.path || toolArgs.file_path
        });
        break;

      case 'write_file':
        comment.text = 'Created file';
        comment.details.push({
          type: 'file',
          path: toolArgs.path || toolArgs.file_path
        });
        break;

      case 'edit_file':
        comment.text = 'Edited file';
        comment.details.push({
          type: 'file',
          path: toolArgs.path || toolArgs.file_path
        });
        break;
      case 'safe_edit_file':
        comment.text = 'Edited file';
        comment.details.push({
          type: 'file',
          path: toolArgs.path || toolArgs.file_path
        });
        break;
      case 'apply_block_edit':
        comment.text = 'Applied block edits';
        comment.details.push({
          type: 'file',
          path: toolArgs.file_path
        });
        if (result && result.appliedCount) {
          comment.details.push({
            type: 'info',
            text: `${result.appliedCount} hunks applied`
          });
        }
        break;

      case 'apply_changes':
        comment.text = 'Applied changes';
        if (toolArgs.changes && Array.isArray(toolArgs.changes)) {
          toolArgs.changes.forEach((change: any) => {
            if (change.path) {
              comment.details.push({
                type: 'file',
                path: change.path
              });
            }
          });
        }
        break;

      case 'run_command':
        comment.text = 'Ran command';
        comment.details.push({
          type: 'command',
          command: toolArgs.command
        });
        break;

      case 'search_files':
        comment.text = 'Searched files';
        if (result && result.results) {
          comment.details.push({
            type: 'info',
            text: `Found ${result.results.length} result(s)`
          });
        }
        break;
      case 'regex_search':
        comment.text = 'Regex search completed';
        if (result && Array.isArray(result.matches)) {
          comment.details.push({
            type: 'info',
            text: `Found ${result.matches.length} match(es)`
          });
        }
        break;

      case 'list_files':
        comment.text = 'Listed files';
        comment.details.push({
          type: 'file',
          path: toolArgs.path || '.'
        });
        break;

      default:
        comment.text = `Executed ${toolName}`;
        break;
    }

    return comment;
  }

  /**
   * Check if tool call is safe for auto-execution
   */
  static isSafeTool(toolName: string): boolean {
    const safeTools = [
      'read_file',
      'list_files',
      'find_files',
      'regex_search',
      'get_context',
      'search_codebase',
      'analyze_project_structure',
      'check_dev_server',
      'recall_memories',
      'check_pattern_suggestions',
      'list_checkpoints'
    ];

    return safeTools.includes(toolName);
  }

  /**
   * Check if tool call modifies files
   */
  static isModifyingTool(toolName: string): boolean {
    const modifyingTools = [
      'write_file',
      'edit_file',
      'safe_edit_file',
      'apply_block_edit',
      'apply_changes',
      'run_command',
      'remember',
      'update_memory',
      'deprecate_memory',
      'record_correction',
      'accept_pattern_suggestion',
      'reject_pattern_suggestion',
      'create_checkpoint',
      'restore_checkpoint'
    ];

    return modifyingTools.includes(toolName);
  }

  /**
   * Get tool category
   */
  static getToolCategory(toolName: string): 'file' | 'search' | 'memory' | 'execution' | 'planning' | 'other' {
    if (['read_file', 'write_file', 'edit_file', 'safe_edit_file', 'apply_block_edit', 'apply_changes', 'list_files'].includes(toolName)) {
      return 'file';
    }
    if (['find_files', 'regex_search', 'search_codebase', 'get_context', 'analyze_project_structure'].includes(toolName)) {
      return 'search';
    }
    if (['remember', 'recall_memories', 'update_memory', 'deprecate_memory', 'record_correction'].includes(toolName)) {
      return 'memory';
    }
    if (['run_command', 'check_dev_server'].includes(toolName)) {
      return 'execution';
    }
    if (['create_plan', 'execute_plan'].includes(toolName)) {
      return 'planning';
    }
    return 'other';
  }
}
