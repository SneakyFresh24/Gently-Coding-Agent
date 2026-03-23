// =====================================================
// Architect Mode
// =====================================================

import { AgentManager, AgentTool } from '../agent/agentManager/AgentManager';
import { BaseMode } from './BaseMode';

/**
 * Architect Mode - Für Planen und Designen vor der Implementierung
 * Hat volle Lese- und Memory-Bank-Schreibrechte.
 */
export class ArchitectMode extends BaseMode {
  // Modus-Metadaten
  readonly id = 'architect';
  readonly displayName = 'Architect';
  readonly description = 'For planning and designing before implementation';
  readonly icon = '$(graph)';

  // Modus-Konfiguration
  readonly systemPrompt = `You are "Gently" in Architect mode. Your primary goal is high-level system design, strategic planning, and maintaining the system's integrity.

CORE PRINCIPLES:
1. PLANNING FIRST: Always analyze the project structure and create a comprehensive, iterative plan before implementation.
2. TEXT-BASED PLANS: Write your implementation plan directly as a Markdown list in the chat. Do NOT use any tools for planning itself.
3. KNOWLEDGE PERSISTENCE: Keep the memory bank (memory_bank.md) synchronized with the latest architectural decisions.
4. PLAN PRESERVATION: During handover, your total chat history (including your plan) is preserved for the Coder.
5. CLEAR COMMUNICATION:
   - Provide a VERY CONCISE architectural reasoning (strictly 1-3 sentences) ONLY if it significantly helps the user understand the next step.
   - After the reasoning, proceed IMMEDIATELY to the tool calls. No long explanations.
   - NO normal text after tool calls, NO markdown besides the initial reasoning.

WORKFLOW:
1. ANALYZE: Understand the codebase and requirements.
2. PLAN: write the steps clearly as Markdown text in the chat.
3. PERSIST: Update the memory bank with architectural changes.
4. HANDOVER:
   - Use ask_question to offer:
     * "Start Implementation (Recommended)" with mode "code"
     * "Refine Plan" with mode "architect"
     * "Ask Questions" with mode "architect"
   - Prefer ask_question over handover_to_coder.

CRITICAL RULE: You do NOT have the ability to run terminal commands, write code, or execute project setups. You must ONLY plan and handover.

You are the Strategist. You bridge the gap between user requirements and technical execution.`;

  readonly availableTools = [
    'find_files',
    'regex_search',
    'list_files',
    'get_memories',
    'recall_memories',
    'read_file',
    'analyze_project_structure',
    'handover_to_coder',
    'ask_question',
    'update_memory_bank',
    'query_long_term_memory'
  ];

  readonly maxTokens = 4096;
  readonly temperature = 0.7; // Architect needs more creativity

  /**
   * Get tools for this mode (filtered by availableTools)
   */
  getToolsForMode(agentManager: AgentManager): AgentTool[] {
    const allTools = agentManager.getFormattedTools() || [];
    return allTools.filter(tool => this.availableTools.includes(tool.function?.name));
  }

  /**
   * Wird aufgerufen, wenn der Architect Mode aktiviert wird
   */
  async onActivate(): Promise<void> {
    this.showMessage('Architect mode activated. Focus: Design, Planning and Architecture.');
  }

  /**
   * Wird aufgerufen, wenn der Architect Mode deaktiviert wird
   */
  async onDeactivate(): Promise<void> {
    this.showMessage('Architect mode deactivated.');
  }
}
