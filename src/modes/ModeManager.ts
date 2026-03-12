// =====================================================
// Mode Manager
// =====================================================

import {
  GentlyMode,
  ModeStatus,
  ModeInfo,
  ModeContext,
  ModeChangeEvent,
  ModeManager as IModeManager,
  ModeRegistry
} from './types/ModeTypes';

/**
 * Manages loading, activating and deactivating modes
 */
export class ModeManager implements IModeManager {
  private currentMode: GentlyMode | null = null;
  private currentModeId: string | null = null;
  private modeRegistry: ModeRegistry;
  private modeInfo: Map<string, ModeInfo> = new Map();
  private modeChangeListeners: Array<(event: ModeChangeEvent) => void> = [];
  private context?: ModeContext;
  private isActive: boolean = false;

  constructor(modeRegistry?: ModeRegistry) {
    this.modeRegistry = modeRegistry || new (require('./ModeRegistry').ModeRegistry)();
  }

  /**
   * Setzt den aktuellen Modus
   */
  async setMode(modeId: string, context?: ModeContext): Promise<void> {
    if (!this.modeRegistry.has(modeId)) {
      throw new Error(`Mode '${modeId}' is not registered`);
    }

    const previousModeId = this.currentModeId;
    const newMode = this.modeRegistry.get(modeId)!;

    // Deaktiviere den aktuellen Modus
    if (this.currentMode) {
      await this.deactivateCurrentMode();
    }

    // Setze den neuen Modus als aktivierend
    this.setModeStatus(newMode.id, ModeStatus.ACTIVATING);

    try {
      // Aktiviere den neuen Modus
      this.currentMode = newMode;
      this.currentModeId = modeId;
      this.context = context;

      // Rufe die onActivate-Methode des Modus auf
      if (newMode.onActivate) {
        await newMode.onActivate();
      }

      // Setze den Status auf aktiv
      this.setModeStatus(newMode.id, ModeStatus.ACTIVE);

      // Benachrichtige die Listener über den Modus-Wechsel
      this.notifyModeChange({
        previousModeId: previousModeId || undefined,
        newModeId: modeId,
        timestamp: new Date()
      });

      console.log(`[ModeManager] Activated mode: ${newMode.displayName} (${modeId})`);
    } catch (error) {
      // Bei Fehler setze den Status auf Fehler
      this.setModeStatus(newMode.id, ModeStatus.ERROR);
      this.currentMode = null;
      this.currentModeId = null;
      
      console.error(`[ModeManager] Error activating mode ${modeId}:`, error);
      throw error;
    }
  }

  /**
   * Gibt den aktuellen Modus zurück
   */
  getCurrentMode(): GentlyMode | null {
    return this.currentMode;
  }

  /**
   * Gibt die ID des aktuellen Modus zurück
   */
  getCurrentModeId(): string | null {
    return this.currentModeId;
  }

  /**
   * Gibt alle verfügbaren Modi zurück
   */
  getAvailableModes(): GentlyMode[] {
    return this.modeRegistry.getAll();
  }

  /**
   * Gibt Informationen zu einem Modus zurück
   */
  getModeInfo(modeId: string): ModeInfo | undefined {
    return this.modeInfo.get(modeId);
  }

  /**
   * Gibt Informationen zu allen Modi zurück
   */
  getAllModeInfo(): ModeInfo[] {
    return Array.from(this.modeInfo.values());
  }

  /**
   * Registriert einen Listener für Modus-Wechsel-Ereignisse
   */
  onModeChange(callback: (event: ModeChangeEvent) => void): void {
    this.modeChangeListeners.push(callback);
  }

  /**
   * Aktiviert den Mode Manager
   */
  async activate(): Promise<void> {
    if (this.isActive) {
      return;
    }

    this.isActive = true;
    console.log('[ModeManager] Activated');
  }

  /**
   * Deaktiviert den Mode Manager
   */
  async deactivate(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    // Deaktiviere den aktuellen Modus
    await this.deactivateCurrentMode();
    
    // Setze den aktuellen Modus auf null
    this.currentMode = null;
    this.currentModeId = null;

    this.isActive = false;
    console.log('[ModeManager] Deactivated');
  }

  /**
   * Gibt den Kontext des aktuellen Modus zurück
   */
  getContext(): ModeContext | undefined {
    return this.context;
  }

  /**
   * Setzt den Kontext
   */
  setContext(context: ModeContext): void {
    this.context = context;
  }

  /**
   * Registriert einen neuen Modus
   */
  registerMode(mode: GentlyMode): void {
    this.modeRegistry.register(mode);
    
    // Erstelle initialen ModeInfo-Eintrag
    this.modeInfo.set(mode.id, {
      mode,
      status: ModeStatus.INACTIVE
    });
  }

  /**
   * Entfernt einen registrierten Modus
   */
  unregisterMode(modeId: string): boolean {
    // Deaktiviere den Modus, falls er aktuell aktiv ist
    if (this.currentModeId === modeId) {
      this.currentMode = null;
      this.currentModeId = null;
    }

    const removed = this.modeRegistry.unregister(modeId);
    if (removed) {
      this.modeInfo.delete(modeId);
    }

    return removed;
  }

  /**
   * Prüft, ob der aktuelle Modus ein bestimmtes Tool verwenden kann
   */
  canUseTool(toolName: string): boolean {
    if (!this.currentMode) {
      return false;
    }

    return this.currentMode.canHandleTool(toolName);
  }

  /**
   * Filtert die verfügbaren Tools basierend auf dem aktuellen Modus
   */
  filterTools(tools: any[]): any[] {
    if (!this.currentMode || !this.currentMode.getToolFilter) {
      return tools;
    }

    return this.currentMode.getToolFilter(tools);
  }

  /**
   * Ressourcen freigeben
   */
  dispose(): void {
    this.deactivate();
    this.modeChangeListeners = [];
    this.modeRegistry.clear();
    this.modeInfo.clear();
  }

  /**
   * Deaktiviert den aktuellen Modus
   */
  private async deactivateCurrentMode(): Promise<void> {
    if (!this.currentMode) {
      return;
    }

    const modeId = this.currentMode.id;
    this.setModeStatus(modeId, ModeStatus.DEACTIVATING);

    try {
      // Rufe die onDeactivate-Methode des Modus auf
      if (this.currentMode.onDeactivate) {
        await this.currentMode.onDeactivate();
      }

      this.setModeStatus(modeId, ModeStatus.INACTIVE);
      console.log(`[ModeManager] Deactivated mode: ${this.currentMode.displayName} (${modeId})`);
      
      // Setze den aktuellen Modus auf null
      this.currentMode = null;
      this.currentModeId = null;
    } catch (error) {
      this.setModeStatus(modeId, ModeStatus.ERROR);
      console.error(`[ModeManager] Error deactivating mode ${modeId}:`, error);
    }
  }

  /**
   * Setzt den Status eines Modus
   */
  private setModeStatus(modeId: string, status: ModeStatus): void {
    let modeInfo = this.modeInfo.get(modeId);
    
    if (!modeInfo) {
      const mode = this.modeRegistry.get(modeId);
      if (!mode) {
        return;
      }
      
      modeInfo = {
        mode,
        status
      };
      this.modeInfo.set(modeId, modeInfo);
    } else {
      modeInfo.status = status;
      
      if (status === ModeStatus.ACTIVE) {
        modeInfo.activatedAt = new Date();
      }
    }
  }

  /**
   * Benachrichtigt alle Listener über einen Modus-Wechsel
   */
  private notifyModeChange(event: ModeChangeEvent): void {
    for (const listener of this.modeChangeListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ModeManager] Error in mode change listener:', error);
      }
    }
  }
}