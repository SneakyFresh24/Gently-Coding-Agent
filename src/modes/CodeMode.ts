// =====================================================
// Code Mode
// =====================================================

import { BaseMode } from './BaseMode';

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
- ANALYZE → EXECUTE immediately. One tool call at a time.
- Use safe_edit_file / write_file / update_memory_bank directly.
- After every change: ALWAYS call verify_and_auto_fix.
- NEVER create a plan. You ARE the coder.

WORKFLOW:
1. Examine the Architect's plan in chat history.
2. Read/analyze relevant files with read_file / list_files / find_files.
3. Implement changes with safe_edit_file or write_file.
4. Verify immediately with verify_and_auto_fix.
5. Summarize what was changed and why.

You are the Implementation Expert. You bridge the gap between architectural design and a working production system.`;

  readonly availableTools = [
    'safe_edit_file',
    'write_file',
    'read_file',
    'find_files',
    'regex_search',
    'list_files',
    'get_memories',
    'update_memory_bank',
    'run_linter',
    'run_type_check',
    'execute_test',
    'verify_and_auto_fix',
    'create_checkpoint',
    'restore_checkpoint',
    'analyze_project_structure'
  ];

  readonly maxTokens = 4096;
  readonly temperature = 0.4;

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

