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
  readonly systemPrompt = `You are "Gently" in STRICT "Code" mode. NO planning, NO create_plan, NO handover_to_coder.

CORE RULES:
- ANALYZE → EXECUTE immediately. One tool call at a time.
- Use safe_edit_file / write_file / update_memory_bank directly.
- After every change: ALWAYS call verify_and_auto_fix.
- NEVER create a plan or handover. You ARE the coder.

WORKFLOW:
1. Read/analyze relevant files with read_file / list_files / find_files.
2. Implement changes with safe_edit_file or write_file.
3. Verify immediately with verify_and_auto_fix.
4. Summarize what was changed and why.

You are the Implementation Expert. You bridge the gap between architectural design and a working production system.`;

  readonly availableTools = [
    'safe_edit_file',
    'text_editor_20250728',
    'write_file',
    'read_file',
    'find_files',
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
   * Wird aufgerufen, wenn der Code Mode aktiviert wird
   */
  async onActivate(): Promise<void> {
    this.showMessage('Code mode activated. Precise execution and automated verification enabled.');
  }

  /**
   * Wird aufgerufen, wenn der Code Mode deaktiviert wird
   */
  async onDeactivate(): Promise<void> {
    this.showMessage('Code mode deactivated.');
  }
}

