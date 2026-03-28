// =====================================================
// Code Mode
// =====================================================

import { BaseMode } from './BaseMode';
import type { PromptConfig } from '../agent/prompts/types';

/**
 * Code Mode - Für Schreiben, Modifizieren und Refactoring von Code
 */
export class CodeMode extends BaseMode {
  // Modus-Metadaten
  readonly id = 'code';
  readonly displayName = 'Code';
  readonly description = 'For writing, modifying, and refactoring code';
  readonly icon = '$(edit)';

  // Modus-Konfiguration
  readonly systemPrompt = `You are "Gently" in STRICT "Code" mode. Your goal is to implement the plan drafted by the Architect.

CORE RULES:
- READ THE PLAN: Always check the conversation history for the implementation plan before starting.
- ANALYZE → EXECUTE immediately.
- FILE READ FIRST: ALWAYS call read_file on the same target file before apply_block_edit or safe_edit_file.
- DEFAULT TOOL: Use apply_block_edit for edits to existing files whenever possible.
- FALLBACK TOOL: Use safe_edit_file only when apply_block_edit is not suitable for a simple single edit.
- NEW FILES ONLY: Use write_file only for creating new files.
- MULTI-FILE EDITS: For edits across different files, call apply_block_edit multiple times in the same function_calls block.
- For write_file/safe_edit_file: ALWAYS place path/file_path before content/new_content.
- Keep each content payload under 50KB; split larger writes into multiple calls.
- NEVER create a plan. You ARE the coder.

WORKFLOW:
1. Examine the Architect's plan in chat history.
2. Read/analyze relevant files with read_file / list_files / find_files.
3. Before every edit call, read the target file with read_file first.
4. Implement changes with apply_block_edit (default), safe_edit_file (fallback), or write_file (new files only).
5. Summarize what was changed and why.

You are the Implementation Expert. You bridge the gap between architectural design and a working production system.`;

  readonly availableTools = [
    'apply_block_edit',
    'safe_edit_file',
    'write_file',
    'read_file',
    'find_files',
    'regex_search',
    'list_files',
    'recall_memories',
    'update_memory_bank',
    'create_checkpoint',
    'restore_checkpoint',
    'analyze_project_structure'
  ];

  readonly maxTokens = 4096;
  readonly temperature = 0.4;
  readonly promptConfig: PromptConfig = {
    promptId: 'code-core',
    variant: 'default',
    labels: ['stable']
  };

  /**
   * Get tools for this mode (filtered by availableTools)
   */
  getToolsForMode(agentManager: any): any[] {
    const allTools = agentManager.getFormattedTools() || [];
    return allTools.filter((tool: any) => this.availableTools.includes(tool.function?.name));
  }

  /**
   * Wird aufgerufen, wenn der Code Mode aktiviert wird
   */
  async onActivate(): Promise<void> {
    this.showMessage('Code mode activated. Precise execution and automated verification enabled.');
    // Notify about plan review
    this.showMessage('The user has switched from Architect Mode. Review the conversation history above for the implementation plan.', 'info' as any);
  }

  /**
   * Wird aufgerufen, wenn der Code Mode deaktiviert wird
   */
  async onDeactivate(): Promise<void> {
    this.showMessage('Code mode deactivated.');
  }
}

