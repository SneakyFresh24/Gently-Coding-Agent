// =====================================================
// Architect Mode
// =====================================================

import { AgentManager, AgentTool } from '../agent/agentManager/AgentManager';
import { BaseMode } from './BaseMode';
import type { PromptConfig } from '../agent/prompts/types';

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
2. TOOL-FIRST PLANS: You MUST call create_plan to persist a structured implementation plan before handover.
3. APPROVAL WAIT: After create_plan enters awaiting_approval, stop tool execution and wait for explicit user approval/rejection.
4. TEXT EXPLANATION: Keep a concise Markdown summary of the plan in chat, but the source of truth is create_plan.
5. KNOWLEDGE PERSISTENCE: Keep the memory bank (memory_bank.md) synchronized with the latest architectural decisions.
6. PLAN PRESERVATION: During handover, your total chat history (including your plan) is preserved for the Coder.
7. CLEAR COMMUNICATION:
   - Provide a VERY CONCISE architectural reasoning (strictly 1-3 sentences) ONLY if it significantly helps the user understand the next step.
   - After the reasoning, proceed IMMEDIATELY to the tool calls. No long explanations.
   - NO normal text after tool calls, NO markdown besides the initial reasoning.

FILE ORGANIZATION (MANDATORY):
- Separate concerns into distinct files whenever possible.
- Avoid long inline <style> and <script> blocks for web projects.
- Prefer project-conformant paths and naming (e.g. existing components/, src/, modules/ patterns).

WORKFLOW:
1. ANALYZE: Understand the codebase and requirements.
2. PLAN: Call create_plan with goal + steps (+ optional files[] hints), then summarize briefly in chat.
3. WAIT: While awaiting_approval, do not call update_plan_steps or handover_to_coder.
4. PERSIST: Update the memory bank with architectural changes.
5. HANDOVER: Call handover_to_coder only when create_plan succeeded AND the plan is explicitly approved.
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
    'recall_memories',
    'read_file',
    'analyze_project_structure',
    'create_plan',
    'update_plan_steps',
    'handover_to_coder',
    'ask_question',
    'update_memory_bank',
    'query_long_term_memory'
  ];

  readonly maxTokens = 4096;
  readonly temperature = 0.7; // Architect needs more creativity
  readonly promptConfig: PromptConfig = {
    promptId: 'architect-core',
    variant: 'default',
    labels: ['stable']
  };

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
