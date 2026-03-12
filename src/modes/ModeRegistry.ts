// =====================================================
// Mode Registry
// =====================================================

import {
  GentlyMode,
  ModeRegistry as IModeRegistry
} from './types/ModeTypes';

/**
 * Registry für die Verwaltung aller verfügbaren Modi
 */
export class ModeRegistry implements IModeRegistry {
  private modes: Map<string, GentlyMode> = new Map();

  /**
   * Registriert einen neuen Modus
   */
  register(mode: GentlyMode): void {
    if (this.modes.has(mode.id)) {
      throw new Error(`Mode with id '${mode.id}' is already registered`);
    }
    
    this.modes.set(mode.id, mode);
    console.log(`[ModeRegistry] Registered mode: ${mode.displayName} (${mode.id})`);
  }

  /**
   * Entfernt einen registrierten Modus
   */
  unregister(modeId: string): boolean {
    const existed = this.modes.delete(modeId);
    
    if (existed) {
      console.log(`[ModeRegistry] Unregistered mode: ${modeId}`);
    }
    
    return existed;
  }

  /**
   * Gibt einen Modus anhand seiner ID zurück
   */
  get(modeId: string): GentlyMode | undefined {
    return this.modes.get(modeId);
  }

  /**
   * Gibt alle registrierten Modi zurück
   */
  getAll(): GentlyMode[] {
    return Array.from(this.modes.values());
  }

  /**
   * Prüft, ob ein Modus mit der angegebenen ID registriert ist
   */
  has(modeId: string): boolean {
    return this.modes.has(modeId);
  }

  /**
   * Entfernt alle registrierten Modi
   */
  clear(): void {
    const modeCount = this.modes.size;
    this.modes.clear();
    console.log(`[ModeRegistry] Cleared ${modeCount} modes`);
  }

  /**
   * Gibt die Anzahl der registrierten Modi zurück
   */
  size(): number {
    return this.modes.size;
  }

  /**
   * Gibt alle Modus-IDs zurück
   */
  getIds(): string[] {
    return Array.from(this.modes.keys());
  }
}