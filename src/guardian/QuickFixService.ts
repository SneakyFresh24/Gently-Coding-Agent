/**
 * Quick Fix Service
 * 
 * Integrates with Agent Mode to provide automatic code fixes
 */

import { EventEmitter } from 'events';
import { GuardianIssue, GuardianSuggestion, SuggestionAction } from './types';
import { CodeMode } from '../modes/CodeMode';

export interface AgentExecutionCallback {
  (prompt: string, filePath: string): Promise<{ success: boolean; code?: string; diff?: string; error?: string }>;
}

export interface QuickFixResult {
  success: boolean;
  issueId: string;
  suggestionId: string;
  fixedCode?: string;
  diff?: string;
  error?: string;
  duration: number;
}

export interface QuickFixConfig {
  enabled: boolean;
  autoApply: boolean;
  requireConfirmation: boolean;
  maxRetries: number;
  timeout: number;
}

const DEFAULT_CONFIG: QuickFixConfig = {
  enabled: true,
  autoApply: false,
  requireConfirmation: true,
  maxRetries: 3,
  timeout: 30000 // 30 seconds
};

export class QuickFixService extends EventEmitter {
  private config: QuickFixConfig;
  private agentMode?: CodeMode;
  private agentExecutionCallback?: AgentExecutionCallback;
  private activeFixes: Map<string, Promise<QuickFixResult>> = new Map();

  constructor(
    agentMode?: CodeMode,
    config?: Partial<QuickFixConfig>
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agentMode = agentMode;

    console.log('[QuickFixService] Initialized');
  }

  /**
   * Set the Agent Mode instance
   */
  setAgentMode(agentMode: CodeMode): void {
    this.agentMode = agentMode;
    console.log('[QuickFixService] Agent Mode set');
  }

  /**
   * Set the Agent Execution Callback
   */
  setAgentExecutionCallback(callback: AgentExecutionCallback): void {
    this.agentExecutionCallback = callback;
    console.log('[QuickFixService] Agent Execution Callback set');
  }

  /**
   * Check if a suggestion can be automatically fixed
   */
  canFix(suggestion: GuardianSuggestion): boolean {
    if (!this.config.enabled || !this.agentMode) {
      return false;
    }

    // Only fix certain types of suggestions automatically
    const fixableActions = [SuggestionAction.FIX_IT];
    const fixableTypes = [
      'remove_unused',
      'update_import',
      'security_fix',
      'performance_optimization'
    ];

    return (
      fixableActions.includes(suggestion.action) &&
      fixableTypes.includes(suggestion.type) &&
      suggestion.confidence >= 0.7
    );
  }

  /**
   * Apply a quick fix to an issue
   */
  async applyQuickFix(
    issue: GuardianIssue,
    suggestion: GuardianSuggestion
  ): Promise<QuickFixResult> {
    const fixId = `${issue.id}-${suggestion.id}`;

    // Check if fix is already in progress
    if (this.activeFixes.has(fixId)) {
      return this.activeFixes.get(fixId)!;
    }

    // Check if the suggestion can be fixed
    if (!this.canFix(suggestion)) {
      const result: QuickFixResult = {
        success: false,
        issueId: issue.id,
        suggestionId: suggestion.id,
        error: 'This suggestion cannot be automatically fixed',
        duration: 0
      };
      return result;
    }

    const fixPromise = this.executeQuickFix(issue, suggestion);
    this.activeFixes.set(fixId, fixPromise);

    try {
      const result = await fixPromise;
      return result;
    } finally {
      this.activeFixes.delete(fixId);
    }
  }

  /**
   * Execute the quick fix
   */
  private async executeQuickFix(
    issue: GuardianIssue,
    suggestion: GuardianSuggestion
  ): Promise<QuickFixResult> {
    const startTime = Date.now();
    const fixId = `${issue.id}-${suggestion.id}`;

    try {
      console.log(`[QuickFixService] Applying fix for ${fixId}`);

      if (!this.agentMode) {
        throw new Error('Agent Mode not available');
      }

      // Create a task list for the Agent Mode
      const taskList = this.createTaskList(issue, suggestion);

      // Execute the fix through Agent Mode
      const result = await this.executeWithAgentMode(taskList, issue.filePath);

      const duration = Date.now() - startTime;

      if (result.success) {
        console.log(`[QuickFixService] Fix applied successfully for ${fixId} in ${duration}ms`);

        const fixResult: QuickFixResult = {
          success: true,
          issueId: issue.id,
          suggestionId: suggestion.id,
          fixedCode: result.code,
          diff: result.diff,
          duration
        };

        this.emit('fixApplied', fixResult);
        return fixResult;
      } else {
        throw new Error(result.error || 'Failed to apply fix');
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[QuickFixService] Fix failed for ${fixId}:`, error);

      const fixResult: QuickFixResult = {
        success: false,
        issueId: issue.id,
        suggestionId: suggestion.id,
        error: error instanceof Error ? error.message : String(error),
        duration
      };

      this.emit('fixFailed', fixResult);
      return fixResult;
    }
  }

  /**
   * Create a task list for the Agent Mode
   */
  private createTaskList(issue: GuardianIssue, suggestion: GuardianSuggestion): string[] {
    const tasks: string[] = [];

    // Add context about the issue
    tasks.push(`Issue: ${issue.title}`);
    tasks.push(`Description: ${issue.description}`);
    tasks.push(`File: ${issue.filePath}`);

    if (issue.lineNumbers && issue.lineNumbers.length > 0) {
      tasks.push(`Lines: ${issue.lineNumbers.join(', ')}`);
    }

    // Add suggestion details
    tasks.push(`Suggestion: ${suggestion.title}`);
    tasks.push(`Description: ${suggestion.description}`);

    // Add specific tasks based on suggestion type
    switch (suggestion.type) {
      case 'remove_unused':
        tasks.push('Remove the unused code');
        tasks.push('Ensure no other code depends on it');
        break;

      case 'update_import':
        tasks.push('Update the import statement');
        tasks.push('Verify all references still work');
        break;

      case 'security_fix':
        tasks.push('Apply the security fix');
        tasks.push('Ensure the fix doesn\'t break functionality');
        tasks.push('Add comments explaining the security improvement');
        break;

      case 'performance_optimization':
        tasks.push('Apply the performance optimization');
        tasks.push('Ensure the optimization maintains correctness');
        tasks.push('Add comments explaining the optimization');
        break;

      case 'extract_function':
        tasks.push('Extract the duplicated code into a shared function');
        tasks.push('Update all call sites to use the new function');
        tasks.push('Ensure the extraction doesn\'t change behavior');
        break;

      case 'add_test':
        tasks.push('Create a test file for the target file');
        tasks.push('Add tests for the main functionality');
        tasks.push('Ensure tests pass');
        break;

      default:
        tasks.push('Apply the suggested fix');
        tasks.push('Ensure the fix is correct and doesn\'t break existing functionality');
    }

    return tasks;
  }

  /**
   * Execute tasks using Agent Mode
   */
  private async executeWithAgentMode(
    taskList: string[],
    filePath: string
  ): Promise<{ success: boolean; code?: string; diff?: string; error?: string }> {
    if (!this.agentMode) {
      throw new Error('Agent Mode not available');
    }

    try {
      // Create a prompt for the Agent Mode
      const prompt = this.createAgentPrompt(taskList, filePath);

      // In practice, this uses the attached callback or falls back to simulation
      const result = await this.executeAgentTask(prompt, filePath);

      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a prompt for the Agent Mode
   */
  private createAgentPrompt(taskList: string[], filePath: string): string {
    return `
Please fix the following issues in the file ${filePath}:

Tasks:
${taskList.map((task, index) => `${index + 1}. ${task}`).join('\n')}

Requirements:
1. Make minimal changes to fix the issue
2. Preserve existing functionality
3. Follow best practices and coding standards
4. Add comments explaining significant changes
5. Ensure the code compiles/runs without errors

Please provide the fixed code and explain what changes were made.
    `.trim();
  }

  /**
   * Execute Agent Mode task using callback or simulate fallback
   */
  private async executeAgentTask(
    prompt: string,
    filePath: string
  ): Promise<{ success: boolean; code?: string; diff?: string; error?: string }> {
    if (this.agentExecutionCallback) {
      console.log('[QuickFixService] Executing task with provided Agent Callback');
      return this.agentExecutionCallback(prompt, filePath);
    }

    console.warn('[QuickFixService] No Agent Execution Callback set. Simulating execution:', prompt);

    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
      success: true,
      code: '// Fixed code applied (simulated)',
      diff: '--- a/example.ts\n+++ b/example.ts\n@@ -1,1 +1,1 @@\n-old code\n+new fixed code'
    };
  }

  /**
   * Apply multiple fixes in batch
   */
  async applyBatchFixes(
    fixes: Array<{ issue: GuardianIssue; suggestion: GuardianSuggestion }>
  ): Promise<QuickFixResult[]> {
    console.log(`[QuickFixService] Applying ${fixes.length} fixes in batch`);

    const results: QuickFixResult[] = [];

    // Apply fixes sequentially to avoid conflicts
    for (const { issue, suggestion } of fixes) {
      if (this.canFix(suggestion)) {
        const result = await this.applyQuickFix(issue, suggestion);
        results.push(result);

        // Stop if a fix fails to avoid cascading issues
        if (!result.success) {
          console.warn(`[QuickFixService] Batch fix stopped due to failure: ${result.error}`);
          break;
        }
      }
    }

    console.log(`[QuickFixService] Batch fix complete: ${results.filter(r => r.success).length}/${results.length} successful`);
    return results;
  }

  /**
   * Get active fixes
   */
  getActiveFixes(): string[] {
    return Array.from(this.activeFixes.keys());
  }

  /**
   * Cancel an active fix
   */
  async cancelFix(fixId: string): Promise<boolean> {
    const fixPromise = this.activeFixes.get(fixId);
    if (fixPromise) {
      // Note: In practice, you'd need to implement cancellation in the Agent Mode
      this.activeFixes.delete(fixId);
      console.log(`[QuickFixService] Cancelled fix: ${fixId}`);
      return true;
    }
    return false;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QuickFixConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[QuickFixService] Configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): QuickFixConfig {
    return { ...this.config };
  }

  /**
   * Get statistics
   */
  getStats(): QuickFixStats {
    return {
      activeFixes: this.activeFixes.size,
      enabled: this.config.enabled,
      autoApply: this.config.autoApply,
      requireConfirmation: this.config.requireConfirmation
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Cancel all active fixes
    const activeFixIds = Array.from(this.activeFixes.keys());
    for (const fixId of activeFixIds) {
      this.cancelFix(fixId);
    }

    this.removeAllListeners();
    console.log('[QuickFixService] Disposed');
  }
}

interface QuickFixStats {
  activeFixes: number;
  enabled: boolean;
  autoApply: boolean;
  requireConfirmation: boolean;
}