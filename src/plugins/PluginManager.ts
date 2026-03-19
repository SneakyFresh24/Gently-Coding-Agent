// =====================================================
// Plugin Manager
// =====================================================

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

import {
  Plugin,
  PluginContext,
  PluginManifest,
  PluginInfo,
  PluginStatus,
  Command,
  Tool,
  Permission,
  PermissionType,
  RequestOptions
} from './types/PluginTypes';

import { HistoryManager } from '../services/HistoryManager';
import { ToolRegistry } from '../agent/tools/ToolRegistry';
import { CommandRegistry } from '../commands/CommandRegistry';

/**
 * Manages loading, activating and deactivating plugins
 */
export class PluginManager {
  private plugins: Map<string, PluginInfo> = new Map();
  private pluginContexts: Map<string, PluginContext> = new Map();

  constructor(
    private sessionManager: HistoryManager,
    private toolRegistry: ToolRegistry,
    private pluginDirectory: string = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.gently/plugins')
  ) { }

  /**
   * Aktiviert ein Plugin
   */
  async activatePlugin(plugin: Plugin, manifest: PluginManifest): Promise<void> {
    const pluginId = plugin.id;

    if (this.plugins.has(pluginId)) {
      throw new Error(`Plugin ${pluginId} is already activated`);
    }

    // Setze Status auf "aktivierend"
    const pluginInfo: PluginInfo = {
      plugin,
      manifest,
      status: PluginStatus.ACTIVATING
    };
    this.plugins.set(pluginId, pluginInfo);

    try {
      // Erstelle Plugin-Kontext
      const context = this.createPluginContext(plugin, manifest);
      this.pluginContexts.set(pluginId, context);

      // Aktiviere Plugin
      await plugin.activate(context);

      // Update Status auf "aktiv"
      pluginInfo.status = PluginStatus.ACTIVE;
      pluginInfo.activatedAt = new Date();

      console.log(`[PluginManager] Activated plugin: ${plugin.name} (${pluginId})`);
      vscode.window.showInformationMessage(`Plugin activated: ${plugin.name}`);
    } catch (error) {
      // Bei Fehler aufräumen
      pluginInfo.status = PluginStatus.ERROR;
      pluginInfo.error = (error as Error).message;

      this.pluginContexts.delete(pluginId);

      console.error(`[PluginManager] Error activating plugin ${pluginId}:`, error);
      vscode.window.showErrorMessage(`Error activating plugin ${plugin.name}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Deaktiviert ein Plugin
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const pluginInfo = this.plugins.get(pluginId);
    if (!pluginInfo) {
      throw new Error(`Plugin ${pluginId} is not activated`);
    }

    try {
      // Setze Status auf "deaktivierend"
      pluginInfo.status = PluginStatus.DEACTIVATING;

      // Deaktiviere Plugin
      await pluginInfo.plugin.deactivate();

      // Entferne registrierte Commands und Tools
      this.removePluginRegistrations(pluginId);

      // Entferne Plugin und Kontext
      this.plugins.delete(pluginId);
      this.pluginContexts.delete(pluginId);

      console.log(`[PluginManager] Deactivated plugin: ${pluginInfo.plugin.name} (${pluginId})`);
      vscode.window.showInformationMessage(`Plugin deactivated: ${pluginInfo.plugin.name}`);
    } catch (error) {
      pluginInfo.status = PluginStatus.ERROR;
      pluginInfo.error = (error as Error).message;

      console.error(`[PluginManager] Error deactivating plugin ${pluginId}:`, error);
      vscode.window.showErrorMessage(`Error deactivating plugin ${pluginInfo.plugin.name}: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Gibt alle aktiven Plugins zurück
   */
  getActivePlugins(): PluginInfo[] {
    return Array.from(this.plugins.values()).filter(
      pluginInfo => pluginInfo.status === PluginStatus.ACTIVE
    );
  }

  /**
   * Gibt alle Plugins zurück
   */
  getAllPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Gibt ein Plugin anhand seiner ID zurück
   */
  getPlugin(pluginId: string): PluginInfo | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Lädt ein Plugin aus einem Verzeichnis
   */
  async loadPluginFromDirectory(pluginPath: string): Promise<void> {
    try {
      // Read manifest file
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestData);

      // Lade Plugin-Modul
      const entryPath = path.join(pluginPath, manifest.entry);
      const pluginModule = require(entryPath);

      // Extrahiere Plugin-Klasse
      const PluginClass = pluginModule.default || pluginModule[manifest.name.replace(/[^a-zA-Z0-9]/g, '')];

      if (!PluginClass) {
        throw new Error(`Plugin class not found in ${entryPath}`);
      }

      // Erstelle Plugin-Instanz
      const plugin: Plugin = new PluginClass();

      // Validiere Plugin
      this.validatePlugin(plugin, manifest);

      // Aktiviere Plugin
      await this.activatePlugin(plugin, manifest);
    } catch (error) {
      console.error(`[PluginManager] Error loading plugin from ${pluginPath}:`, error);
      vscode.window.showErrorMessage(`Error loading plugin: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Lädt alle Plugins aus dem Plugin-Verzeichnis
   */
  async loadAllPlugins(): Promise<void> {
    try {
      // Stelle sicher, dass das Plugin-Verzeichnis existiert
      await this.ensurePluginDirectory();

      // Lese alle Unterverzeichnisse
      const entries = await fs.readdir(this.pluginDirectory, { withFileTypes: true });
      const pluginDirectories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(this.pluginDirectory, entry.name));

      // Lade jedes Plugin
      for (const pluginDir of pluginDirectories) {
        try {
          await this.loadPluginFromDirectory(pluginDir);
        } catch (error) {
          console.error(`[PluginManager] Failed to load plugin from ${pluginDir}:`, error);
          // Fahre mit anderen Plugins fort
        }
      }
    } catch (error) {
      console.error(`[PluginManager] Error loading plugins:`, error);
      vscode.window.showErrorMessage(`Error loading plugins: ${(error as Error).message}`);
    }
  }

  /**
   * Erstellt einen Plugin-Kontext
   */
  private createPluginContext(plugin: Plugin, manifest: PluginManifest): PluginContext {
    const pluginId = plugin.id;
    const registeredCommands: string[] = [];
    const registeredTools: string[] = [];

    return {
      sessionManager: this.sessionManager,
      toolRegistry: this.toolRegistry,

      registerCommand: (command) => {
        // Prüfe Berechtigung
        if (!this.hasPermission(pluginId, 'command.execute')) {
          throw new Error(`Plugin ${pluginId} does not have permission to register commands`);
        }

        const commandId = `${pluginId}.${command.id}`;
        // Commands werden vorerst nicht registriert, da das Command-System noch überarbeitet wird
        console.log(`[PluginManager] Would register command: ${commandId}`);
        registeredCommands.push(commandId);
      },

      registerTool: (tool) => {
        // Prüfe Berechtigung
        if (!this.hasPermission(pluginId, 'tool.execute')) {
          throw new Error(`Plugin ${pluginId} does not have permission to register tools`);
        }

        const toolId = `${pluginId}.${tool.id}`;
        const agentTool = {
          name: toolId,
          description: tool.description,
          parameters: tool.parameters,
          execute: tool.handler
        };
        this.toolRegistry.registerMany([agentTool]);
        registeredTools.push(toolId);
      },

      showInformationMessage: (message) => {
        vscode.window.showInformationMessage(`[${plugin.name}] ${message}`);
      },

      showWarningMessage: (message) => {
        vscode.window.showWarningMessage(`[${plugin.name}] ${message}`);
      },

      showErrorMessage: (message) => {
        vscode.window.showErrorMessage(`[${plugin.name}] ${message}`);
      },

      readFile: async (filePath) => {
        // Prüfe Berechtigung
        if (!this.hasPermission(pluginId, 'file.read')) {
          throw new Error(`Plugin ${pluginId} does not have permission to read files`);
        }

        try {
          const absolutePath = path.resolve(filePath);
          return await fs.readFile(absolutePath, 'utf-8');
        } catch (error) {
          throw new Error(`Error reading file ${filePath}: ${(error as Error).message}`);
        }
      },

      writeFile: async (filePath, content) => {
        // Prüfe Berechtigung
        if (!this.hasPermission(pluginId, 'file.write')) {
          throw new Error(`Plugin ${pluginId} does not have permission to write files`);
        }

        try {
          const absolutePath = path.resolve(filePath);
          await fs.writeFile(absolutePath, content, 'utf-8');
        } catch (error) {
          throw new Error(`Error writing file ${filePath}: ${(error as Error).message}`);
        }
      },

      makeRequest: async (url, options = {}) => {
        // Prüfe Berechtigung
        if (!this.hasPermission(pluginId, 'network.request')) {
          throw new Error(`Plugin ${pluginId} does not have permission to make network requests`);
        }

        return new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {}
          };

          const lib = urlObj.protocol === 'https:' ? https : http;
          const req = lib.request(requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const jsonData = JSON.parse(data);
                resolve(jsonData);
              } catch (error) {
                resolve(data);
              }
            });
          });

          req.on('error', (error) => {
            reject(new Error(`Error making request to ${url}: ${error.message}`));
          });

          if (options.body) {
            req.write(options.body);
          }

          req.end();
        });
      }
    };
  }

  /**
   * Entfernt alle Registrierungen eines Plugins
   */
  private removePluginRegistrations(pluginId: string): void {
    // Commands entfernen
    // Tools entfernen
    // Implementierung abhängig von den Registrierungs-Systemen
  }

  /**
   * Validiert ein Plugin gegen sein Manifest
   */
  private validatePlugin(plugin: Plugin, manifest: PluginManifest): void {
    if (!plugin.id || !plugin.name || !plugin.version) {
      throw new Error('Plugin must have id, name, and version');
    }

    if (plugin.id !== manifest.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) {
      throw new Error('Plugin id must match manifest name');
    }
  }

  /**
   * Prüft, ob ein Plugin eine bestimmte Berechtigung hat
   */
  private hasPermission(pluginId: string, permissionType: PermissionType): boolean {
    const pluginInfo = this.plugins.get(pluginId);
    if (!pluginInfo) {
      return false;
    }

    return pluginInfo.manifest.permissions.some(
      permission => permission.type === permissionType
    );
  }

  /**
   * Stellt sicher, dass das Plugin-Verzeichnis existiert
   */
  private async ensurePluginDirectory(): Promise<void> {
    try {
      await fs.access(this.pluginDirectory);
    } catch (error) {
      // Verzeichnis existiert nicht, erstelle es
      await fs.mkdir(this.pluginDirectory, { recursive: true });
    }
  }
}