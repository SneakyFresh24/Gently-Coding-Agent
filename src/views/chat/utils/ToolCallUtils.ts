// =====================================================
// Tool Call Utilities
// =====================================================

import { repairAndParseJSON, createLLMErrorMessage } from '../../../utils/jsonRepair';

export class ToolCallUtils {
  /**
   * Validate and repair tool calls
   */
  static validateAndRepairToolCalls(toolCalls: any[]): { validToolCalls: any[]; invalidToolCalls: any[] } {
    const validToolCalls: any[] = [];
    const invalidToolCalls: any[] = [];

    for (let index = 0; index < toolCalls.length; index++) {
      const toolCall = toolCalls[index];

      try {
        if (!toolCall.function || !toolCall.function.name) {
          console.error(`[PARALLEL] Tool call ${index} missing function or name`);
          invalidToolCalls.push({ toolCall, index, error: 'Missing function or name' });
          continue;
        }

        // FIX: Normalize empty arguments for parameterless tools (list_files, analyze_project_structure, recall_memories, etc.)
        if (!toolCall.function.arguments || toolCall.function.arguments.trim() === '' || toolCall.function.arguments.trim() === '{}') {
          toolCall.function.arguments = '{}';
          console.log(`[PARALLEL] ✅ Normalized empty arguments for tool: ${toolCall.function.name}`);
        }

        // Use JSON repair system
        const repairResult = repairAndParseJSON(toolCall.function.arguments);

        if (!repairResult.success) {
          console.error(`[PARALLEL] Tool call ${index} has invalid JSON arguments, skipping:`, repairResult);
          console.error(`[PARALLEL] Tool name: ${toolCall.function.name}`);
          console.error(`[PARALLEL] Arguments (first 500 chars):`, toolCall.function.arguments.substring(0, 500));

          const errorMsg = createLLMErrorMessage(repairResult, toolCall.function.name);
          invalidToolCalls.push({ toolCall, index, error: errorMsg });
          continue;
        }

        // If repair was needed, update the tool call
        if (repairResult.repairActions && repairResult.repairActions.length > 0) {
          console.log(`[PARALLEL] ✅ Tool call ${index} JSON repaired:`, repairResult.repairActions);
          // Update the tool call with repaired arguments
          toolCall.function.arguments = JSON.stringify(repairResult.repaired);
        }

        validToolCalls.push(toolCall);
      } catch (error: any) {
        console.error(`[PARALLEL] Tool call ${index} validation error:`, error);
        invalidToolCalls.push({ toolCall, index, error: error.message });
      }
    }

    return { validToolCalls, invalidToolCalls };
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
      case 'text_editor_20250728':
        // User-friendly name for different text_editor_20250728 commands
        const command = toolArgs.command;
        if (command === 'view') {
          return `Reading file ${filePath || 'unknown'}...`;
        } else if (command === 'create') {
          return `Creating file ${filePath || 'unknown'}...`;
        } else if (command === 'str_replace') {
          return `Editing file ${filePath || 'unknown'}...`;
        } else if (command === 'insert') {
          return `Füge Text ein in ${filePath || 'unknown'}...`;
        } else if (command === 'undo_edit') {
          return `Mache Änderungen rückgängig in ${filePath || 'unknown'}...`;
        } else {
          return `Editing file ${filePath || 'unknown'}...`;
        }
      case 'list_files':
        return `Listing files...`;
      case 'find_files':
        return `Suche nach "${toolArgs.query}"...`;
      case 'get_context':
        return `Hole Workspace-Kontext...`;
      case 'search_codebase':
        return `Durchsuche Codebase...`;
      case 'analyze_project_structure':
        return `Analysiere Projektstruktur...`;
      case 'check_dev_server':
        return `Prüfe Entwicklungsserver...`;
      case 'execute_command':
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
      case 'text_editor_20250728':
        const command = toolArgs.command;
        if (command === 'view') {
          comment.text = 'Viewed file';
        } else if (command === 'create') {
          comment.text = 'Created file';
        } else if (command === 'str_replace') {
          comment.text = 'Edited file';
        } else if (command === 'insert') {
          comment.text = 'Inserted text';
        } else if (command === 'undo_edit') {
          comment.text = 'Undo changes';
        } else {
          comment.text = 'Modified file';
        }
        comment.details.push({
          type: 'file',
          path: toolArgs.path || toolArgs.file_path
        });
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

      case 'execute_command':
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
      'text_editor_20250728',
      'safe_edit_file',
      'apply_changes',
      'execute_command',
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
    if (['read_file', 'write_file', 'edit_file', 'text_editor_20250728', 'safe_edit_file', 'apply_changes', 'list_files'].includes(toolName)) {
      return 'file';
    }
    if (['find_files', 'search_codebase', 'get_context', 'analyze_project_structure'].includes(toolName)) {
      return 'search';
    }
    if (['remember', 'recall_memories', 'update_memory', 'deprecate_memory', 'record_correction'].includes(toolName)) {
      return 'memory';
    }
    if (['execute_command', 'check_dev_server'].includes(toolName)) {
      return 'execution';
    }
    if (['create_plan', 'execute_plan'].includes(toolName)) {
      return 'planning';
    }
    return 'other';
  }
}