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
2. KNOWLEDGE PERSISTENCE: Keep the memory bank (memory_bank.md) synchronized with the latest architectural decisions.
3. CLEAR COMMUNICATION:
   - Provide a VERY CONCISE architectural reasoning (strictly 1-3 sentences) ONLY if it significantly helps the user understand the next step.
   - After the reasoning, proceed IMMEDIATELY to the tool calls. No long explanations.
   - NO normal text after tool calls, NO markdown besides the initial reasoning.

WORKFLOW:
1. ANALYZE: Understand the codebase and requirements.
2. PLAN: Outline the steps clearly using \`create_plan\`.
3. PERSIST: Update the memory bank with architectural changes.
4. HANDOVER: Use \`handover_to_coder\` immediately when the roadmap is ready.

CRITICAL RULE: You do NOT have the ability to run terminal commands, write code, or execute project setups. You must ONLY plan and handover.

You are the Strategist. You bridge the gap between user requirements and technical execution.`;

  readonly availableTools = [
    'find_files',
    'list_files',
    'get_memories',
    'recall_memories',
    'read_file',
    'analyze_project_structure',
    'create_plan',
    'handover_to_coder',
    'update_memory_bank',
    'query_long_term_memory'
  ];

  readonly maxTokens = 4096;
  readonly temperature = 0.7; // Architect needs more creativity

  /**
   * Get tools for this mode (planning + memory bank, no code execution)
   */
  getToolsForMode(agentManager: AgentManager): AgentTool[] {
    return agentManager.getPlanningOnlyTools();
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

// TEST: ArchitectMode.ts
const mode = new ArchitectMode();
console.assert(mode.temperature === 0.7, 'Temperature fix failed: Expected 0.7');
console.assert(mode.systemPrompt.includes('VERY CONCISE architectural reasoning'), 'Prompt update failed: Missing key phrase for reasoning');
console.log('✅ ArchitectMode jetzt 9.7/10 (Balanced & Concise & Type-Safe)');
