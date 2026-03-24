// =====================================================
// Base Mode
// =====================================================

import {
  GentlyMode,
  ModeContext
} from './types/ModeTypes';
import { AgentTool } from '../agent/agentManager/AgentManager';
import type { PromptConfig, PromptContext } from '../agent/prompts/types';

/**
 * Basisklasse für alle Modi
 */
export abstract class BaseMode implements GentlyMode {
  // Modus-Metadaten
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly description: string;
  readonly icon?: string;

  // Modus-Konfiguration
  abstract readonly systemPrompt: string;
  abstract readonly availableTools: string[];
  readonly promptConfig?: PromptConfig;
  readonly maxTokens?: number;
  readonly temperature?: number;

  // Interner Zustand
  protected context?: ModeContext;

  /**
   * Wird aufgerufen, wenn der Modus aktiviert wird
   */
  async onActivate(): Promise<void> {
    // Standard-Implementierung, kann von Unterklassen überschrieben werden
  }

  /**
   * Wird aufgerufen, wenn der Modus deaktiviert wird
   */
  async onDeactivate(): Promise<void> {
    // Standard-Implementierung, kann von Unterklassen überschrieben werden
  }

  /**
   * Setzt den Kontext für den Modus
   */
  setContext(context: ModeContext): void {
    this.context = context;
  }

  /**
   * Gibt den Kontext zurück
   */
  getContext(): ModeContext | undefined {
    return this.context;
  }

  /**
   * Prüft, ob der Modus ein bestimmtes Tool verwenden kann
   */
  canHandleTool(toolName: string): boolean {
    return this.availableTools.includes(toolName);
  }

  /**
   * Optional custom system prompt builder hook per mode.
   * Defaults to legacy static system prompt for backward compatibility.
   */
  buildSystemPrompt(_context: PromptContext): string {
    return this.systemPrompt;
  }

  /**
   * Filtert die verfügbaren Tools basierend auf dem Modus
   */
  getToolFilter(tools: AgentTool[]): AgentTool[] {
    return tools.filter(tool => this.canHandleTool(tool.name));
  }

  /**
   * Gibt alle für diesen Modus verfügbaren Tools zurück
   */
  abstract getToolsForMode(agentManager: any): any[];

  /**
   * Zeigt eine Nachricht an
   */
  protected showMessage(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
    if (this.context) {
      this.context.showMessage(message, type);
    }
  }

  /**
   * Aktualisiert die UI
   */
  protected updateUI(): void {
    if (this.context && this.context.updateUI) {
      this.context.updateUI();
    }
  }
}
