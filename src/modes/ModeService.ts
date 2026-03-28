// =====================================================
// Mode Service
// =====================================================

import * as vscode from 'vscode';
import { ModeManager } from './ModeManager';
import { ArchitectMode } from './ArchitectMode';
import { CodeMode } from './CodeMode';
import type { PromptConfig, PromptContext, PromptVariant } from '../agent/prompts/types';

/**
 * Service für die Verwaltung und Integration des Mode-Systems
 */
export class ModeService {
  private modeManager: ModeManager;
  private context?: vscode.ExtensionContext;

  constructor(context?: vscode.ExtensionContext) {
    this.context = context;
    this.modeManager = new ModeManager();

    this.registerBuiltInModes();
  }

  /**
   * Initialisiert alle verfügbaren Modi
   */
  private registerBuiltInModes(): void {
    // ModeManager.ts requires registerMode
    this.modeManager.registerMode(new ArchitectMode());
    this.modeManager.registerMode(new CodeMode());

    // Setze Architect Mode als Standardmodus
    this.modeManager.setMode('architect');
  }

  /**
   * Gibt den Mode Manager zurück
   */
  getModeManager(): ModeManager {
    return this.modeManager;
  }

  /**
   * Gibt den aktuellen Modus zurück
   */
  getCurrentMode() {
    return this.modeManager.getCurrentMode();
  }

  /**
   * Setzt einen Modus
   */
  async setMode(modeId: string): Promise<void> {
    return this.modeManager.setMode(modeId);
  }

  /**
   * Registriert einen Listener für Modus-Wechsel
   */
  onModeChange(callback: (event: any) => void): void {
    this.modeManager.onModeChange(callback);
  }

  /**
   * Aktiviert den Mode Service
   */
  async activate(): Promise<void> {
    await this.modeManager.activate();
  }

  /**
   * Deaktiviert den Mode Service
   */
  async deactivate(): Promise<void> {
    await this.modeManager.deactivate();
  }

  /**
   * Gibt die verfügbaren Tools für den aktuellen Modus zurück
   */
  getAvailableTools(tools: any[]): any[] {
    return this.modeManager.filterTools(tools);
  }

  /**
   * Prüft, ob der aktuelle Modus ein bestimmtes Tool verwenden kann
   */
  canUseTool(toolName: string): boolean {
    return this.modeManager.canUseTool(toolName);
  }

  /**
   * Gibt den System-Prompt für den aktuellen Modus zurück
   */
  getSystemPrompt(promptContext?: PromptContext): string {
    const currentMode = this.modeManager.getCurrentMode();
    if (!currentMode) {
      return '';
    }
    if (promptContext && currentMode.buildSystemPrompt) {
      return currentMode.buildSystemPrompt(promptContext);
    }
    return currentMode.systemPrompt;
  }

  /**
   * Gibt die Prompt-Konfiguration des aktuellen Modus zurück.
   */
  getPromptConfig(): PromptConfig | undefined {
    const currentMode = this.modeManager.getCurrentMode();
    if (!currentMode?.promptConfig) {
      return undefined;
    }

    const configuredVariant = vscode.workspace.getConfiguration('gently').get<string>('promptPipeline.variant');
    const configuredPromptId = vscode.workspace.getConfiguration('gently').get<string>('promptPipeline.promptId');
    const variant = (configuredVariant === 'default' || configuredVariant === 'minimal' || configuredVariant === 'detailed')
      ? configuredVariant as PromptVariant
      : currentMode.promptConfig.variant;

    return {
      ...currentMode.promptConfig,
      promptId: configuredPromptId?.trim() ? configuredPromptId.trim() : currentMode.promptConfig.promptId,
      variant
    };
  }

  /**
   * Feature flag for the new prompt pipeline.
   */
  isPromptPipelineEnabled(): boolean {
    return vscode.workspace.getConfiguration('gently').get<boolean>('promptPipeline.enabled', true);
  }

  /**
   * Gibt die maximale Token-Anzahl für den aktuellen Modus zurück
   */
  getMaxTokens(): number {
    const currentMode = this.modeManager.getCurrentMode();
    return currentMode ? currentMode.maxTokens || 2048 : 2048;
  }

  /**
   * Gibt die Temperatur für den aktuellen Modus zurück
   */
  getTemperature(): number {
    const currentMode = this.modeManager.getCurrentMode();
    const modeTemperature = currentMode?.temperature ?? 0.7;
    const configured = vscode.workspace.getConfiguration('gently').get<number>('temperature');
    if (typeof configured !== 'number' || Number.isNaN(configured)) {
      return modeTemperature;
    }
    return Math.min(2, Math.max(0, configured));
  }
}
