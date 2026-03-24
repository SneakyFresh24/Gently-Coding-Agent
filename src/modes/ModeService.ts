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
    this.setupCommands();
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
   * Registriert VS Code Commands für die Modi
   */
  private setupCommands(): void {
    if (!this.context) {
      return;
    }

    // Command zum Wechseln des Modus
    const setModeCommand = vscode.commands.registerCommand(
      'gently.setMode',
      async (modeId: string) => {
        try {
          await this.modeManager.setMode(modeId);
          const currentMode = this.modeManager.getCurrentMode();
          if (currentMode) {
            vscode.window.showInformationMessage(
              `Switched to ${currentMode.displayName} mode`
            );
          }
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to switch mode: ${(error as Error).message}`
          );
        }
      }
    );

    // Command zum Anzeigen des aktuellen Modus
    const showModeCommand = vscode.commands.registerCommand(
      'gently.showMode',
      () => {
        const currentMode = this.modeManager.getCurrentMode();
        if (currentMode) {
          vscode.window.showInformationMessage(
            `Current mode: ${currentMode.displayName} (${currentMode.id})`
          );
        } else {
          vscode.window.showInformationMessage('No mode is currently active');
        }
      }
    );

    // Command zum Anzeigen aller verfügbaren Modi
    const listModesCommand = vscode.commands.registerCommand(
      'gently.listModes',
      async () => {
        const availableModes = this.modeManager.getAvailableModes();
        const modeItems = availableModes.map(mode => ({
          label: mode.displayName,
          description: mode.description,
          id: mode.id
        }));

        const selectedMode = await vscode.window.showQuickPick(modeItems, {
          placeHolder: 'Select a mode to switch to'
        });

        if (selectedMode) {
          try {
            await this.modeManager.setMode(selectedMode.id);
            vscode.window.showInformationMessage(
              `Switched to ${selectedMode.label} mode`
            );
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to switch mode: ${(error as Error).message}`
            );
          }
        }
      }
    );

    // Registriere alle Commands
    this.context.subscriptions.push(
      setModeCommand,
      showModeCommand,
      listModesCommand
    );
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
    return currentMode ? currentMode.temperature || 0.7 : 0.7;
  }
}
