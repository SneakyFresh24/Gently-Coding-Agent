// =====================================================
// Plugin Types
// =====================================================

import { HistoryManager } from '../../services/HistoryManager';
import { ToolRegistry } from '../../agent/tools/ToolRegistry';
import { CommandRegistry } from '../../commands/CommandRegistry';

/**
 * Plugin-Schnittstelle, die alle Plugins implementieren müssen
 */
export interface Plugin {
  // Plugin-Metadaten
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  
  // Plugin-Lebenszyklus
  activate(context: PluginContext): void | Promise<void>;
  deactivate(): void | Promise<void>;
}

/**
 * Plugin-Kontext, der dem Plugin bei der Aktivierung übergeben wird
 */
export interface PluginContext {
  // Zugriff auf Kern-Services
  sessionManager: HistoryManager;
  toolRegistry: ToolRegistry;
  
  // Registrierungsfunktionen
  registerCommand(command: Command): void;
  registerTool(tool: Tool): void;
  
  // Benachrichtigungssystem
  showInformationMessage(message: string): void;
  showWarningMessage(message: string): void;
  showErrorMessage(message: string): void;
  
  // File system access
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  
  // Netzwerk-Zugriff
  makeRequest(url: string, options?: RequestOptions): Promise<any>;
}

/**
 * Command-Schnittstelle für VS Code Commands
 */
export interface Command {
  id: string;
  title: string;
  category?: string;
  handler: (...args: any[]) => Promise<void>;
}

/**
 * Tool-Schnittstelle für Agent-Tools
 */
export interface Tool {
  id: string;
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: (params: Record<string, any>) => Promise<any>;
}

/**
 * Parameter-Definition für Tools
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  defaultValue?: any;
}

/**
 * Plugin-Manifest-Schnittstelle
 */
export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string;
  permissions: Permission[];
  dependencies?: Record<string, string>;
}

/**
 * Berechtigungen, die ein Plugin anfordern kann
 */
export interface Permission {
  type: PermissionType;
  description: string;
}

/**
 * Berechtigungstypen
 */
export type PermissionType = 
  | 'tool.execute'       // Can it define new tools?
  | 'file.read'          // Can it read files?
  | 'file.write'         // Can it write files?
  | 'network.request'    // Can it make network requests?
  | 'session.access'     // Darf es auf Sessions zugreifen?
  | 'command.execute';   // Darf es neue Commands definieren?

/**
 * Netzwerk-Request-Optionen
 */
export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

/**
 * Plugin-Status-Enum
 */
export enum PluginStatus {
  INACTIVE = 'inactive',
  ACTIVATING = 'activating',
  ACTIVE = 'active',
  DEACTIVATING = 'deactivating',
  ERROR = 'error'
}

/**
 * Plugin-Informationen
 */
export interface PluginInfo {
  plugin: Plugin;
  manifest: PluginManifest;
  status: PluginStatus;
  error?: string;
  activatedAt?: Date;
}