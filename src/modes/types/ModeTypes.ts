// =====================================================
// Mode Types
// =====================================================

import { AgentTool } from '../../agent/agentManager/AgentManager';

/**
 * Basis-Schnittstelle für alle Modi
 */
export interface GentlyMode {
  // Modus-Metadaten
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly icon?: string;
  
  // Modus-Konfiguration
  readonly systemPrompt: string;
  readonly availableTools: string[];
  readonly maxTokens?: number;
  readonly temperature?: number;
  
  // Lebenszyklus-Methoden
  onActivate?(): void | Promise<void>;
  onDeactivate?(): void | Promise<void>;
  
  // Modus-spezifische Methoden
  canHandleTool(toolName: string): boolean;
  getToolFilter?(tools: AgentTool[]): AgentTool[];
}

/**
 * Modus-Status-Enum
 */
export enum ModeStatus {
  INACTIVE = 'inactive',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  ERROR = 'error'
}

/**
 * Modus-Informationen
 */
export interface ModeInfo {
  mode: GentlyMode;
  status: ModeStatus;
  error?: string;
  activatedAt?: Date;
}

/**
 * Modus-Kontext
 */
export interface ModeContext {
  // Workspace-Informationen
  workspaceRoot: string;
  openFiles: string[];
  currentFile?: string;
  
  // Agent-Kontext
  agentManager: any;
  sessionManager: any;
  
  // UI-Kontext
  showMessage(message: string, type: 'info' | 'warning' | 'error'): void;
  updateUI?(): void;
}

/**
 * Modus-Wechsel-Ereignis
 */
export interface ModeChangeEvent {
  previousModeId?: string;
  newModeId: string;
  timestamp: Date;
}

/**
 * Modus-Registry-Schnittstelle
 */
export interface ModeRegistry {
  register(mode: GentlyMode): void;
  unregister(modeId: string): boolean;
  get(modeId: string): GentlyMode | undefined;
  getAll(): GentlyMode[];
  has(modeId: string): boolean;
  clear(): void;
}

/**
 * Modus-Manager-Schnittstelle
 */
export interface ModeManager {
  // Modus-Verwaltung
  setMode(modeId: string, context?: ModeContext): Promise<void>;
  getCurrentMode(): GentlyMode | null;
  getCurrentModeId(): string | null;
  getAvailableModes(): GentlyMode[];
  
  // Modus-Informationen
  getModeInfo(modeId: string): ModeInfo | undefined;
  getAllModeInfo(): ModeInfo[];
  
  // Ereignis-Handler
  onModeChange(callback: (event: ModeChangeEvent) => void): void;
  
  // Lebenszyklus
  activate(): Promise<void>;
  deactivate(): Promise<void>;
  dispose(): void;
}