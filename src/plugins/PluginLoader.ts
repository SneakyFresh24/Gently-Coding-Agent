// =====================================================
// Plugin Loader
// =====================================================

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Plugin, PluginManifest } from './types/PluginTypes';
import { PluginManager } from './PluginManager';
import { GitPlugin } from './git/GitPlugin';
import { DockerPlugin } from './docker/DockerPlugin';

/**
 * Lädt und verwaltet Plugins für den VS Code Agent
 */
export class PluginLoader {
  constructor(private pluginManager: PluginManager) { }

  /**
   * Lädt und aktiviert alle verfügbaren Plugins
   */
  async loadPlugins(): Promise<void> {
    try {
      console.log('[PluginLoader] Loading plugins...');

      // Stelle sicher, dass das Plugin-Verzeichnis existiert
      await this.ensurePluginDirectory();

      // Load built-in plugins directly
      await this.loadBuiltInPlugins();

      // Lade alle verfügbaren externen Plugins
      const plugins = await this.discoverPlugins();

      // Aktiviere alle Plugins
      for (const plugin of plugins) {
        try {
          await this.pluginManager.activatePlugin(plugin.plugin, plugin.manifest);
        } catch (error) {
          console.error(`[PluginLoader] Failed to activate plugin ${plugin.plugin.id}:`, error);
          vscode.window.showErrorMessage(`Failed to activate plugin ${plugin.plugin.name}: ${(error as Error).message}`);
        }
      }

      console.log(`[PluginLoader] Loaded ${plugins.length} plugins`);
    } catch (error) {
      console.error('[PluginLoader] Error loading plugins:', error);
      vscode.window.showErrorMessage(`Error loading plugins: ${(error as Error).message}`);
    }
  }

  /**
   * Lädt die fest eingebauten Plugins wie Git und Docker
   */
  private async loadBuiltInPlugins(): Promise<void> {
    try {
      console.log('[PluginLoader] Loading built-in plugins...');

      const gitPlugin = new GitPlugin();
      const gitManifest = {
        name: "git",
        version: "1.0.0",
        description: "Provides Git commands and tools for the VS Code Agent",
        author: "VS Code Agent Team",
        entry: "GitPlugin.js",
        permissions: [
          { type: 'tool.execute' as any, description: "Register Git tools" },
          { type: 'command.execute' as any, description: "Register Git commands" },
          { type: 'file.read' as any, description: "Read Git configuration files" },
          { type: 'network.request' as any, description: "Access remote Git repositories" }
        ]
      } as PluginManifest;
      await this.pluginManager.activatePlugin(gitPlugin, gitManifest);

      const dockerPlugin = new DockerPlugin();
      const dockerManifest = {
        name: "docker",
        version: "1.0.0",
        description: "Provides Docker commands and tools for the VS Code Agent",
        author: "VS Code Agent Team",
        entry: "DockerPlugin.js",
        permissions: [
          { type: 'tool.execute' as any, description: "Register Docker tools" },
          { type: 'command.execute' as any, description: "Register Docker commands" },
          { type: 'file.read' as any, description: "Read Docker configuration files" },
          { type: 'network.request' as any, description: "Access Docker registries" }
        ]
      } as PluginManifest;
      await this.pluginManager.activatePlugin(dockerPlugin, dockerManifest);

    } catch (error) {
      console.error('[PluginLoader] Error loading built-in plugins:', error);
    }
  }

  /**
   * Entdeckt alle verfügbaren Plugins im Plugin-Verzeichnis
   */
  async discoverPlugins(): Promise<Array<{ plugin: Plugin; manifest: any }>> {
    const plugins: Array<{ plugin: Plugin; manifest: any }> = [];

    try {
      // Lese alle Unterverzeichnisse im Plugin-Verzeichnis
      const entries = await fs.readdir(this.pluginManager['pluginDirectory'], { withFileTypes: true });
      const pluginDirectories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(this.pluginManager['pluginDirectory'], entry.name));

      // Lade jedes Plugin
      for (const pluginDir of pluginDirectories) {
        try {
          const plugin = await this.loadPluginFromDirectory(pluginDir);
          if (plugin) {
            plugins.push(plugin);
          }
        } catch (error) {
          console.error(`[PluginLoader] Failed to load plugin from ${pluginDir}:`, error);
        }
      }
    } catch (error) {
      console.error('[PluginLoader] Error discovering plugins:', error);
    }

    return plugins;
  }

  /**
   * Lädt ein Plugin aus einem Verzeichnis
   */
  private async loadPluginFromDirectory(pluginPath: string): Promise<{ plugin: Plugin; manifest: any } | null> {
    try {
      // Read manifest file
      const manifestPath = path.join(pluginPath, 'plugin.json');
      const manifestData = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestData);

      // Check if the manifest file is valid
      if (!this.isValidManifest(manifest)) {
        throw new Error('Invalid plugin manifest');
      }

      // Lade Plugin-Modul
      const entryPath = path.join(pluginPath, manifest.entry);

      // Check if the plugin file exists
      try {
        await fs.access(entryPath);
      } catch (error) {
        throw new Error(`Plugin entry file not found: ${entryPath}`);
      }

      // Lade Plugin-Modul dynamisch
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

      return { plugin, manifest };
    } catch (error) {
      console.error(`[PluginLoader] Error loading plugin from ${pluginPath}:`, error);
      return null;
    }
  }

  /**
   * Validiert ein Plugin-Manifest
   */
  private isValidManifest(manifest: any): boolean {
    return (
      manifest &&
      typeof manifest.name === 'string' &&
      typeof manifest.version === 'string' &&
      typeof manifest.description === 'string' &&
      typeof manifest.author === 'string' &&
      typeof manifest.entry === 'string' &&
      Array.isArray(manifest.permissions)
    );
  }

  /**
   * Validiert ein Plugin gegen sein Manifest
   */
  private validatePlugin(plugin: Plugin, manifest: any): void {
    if (!plugin.id || !plugin.name || !plugin.version) {
      throw new Error('Plugin must have id, name, and version');
    }

    if (plugin.id !== manifest.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()) {
      throw new Error('Plugin id must match manifest name');
    }

    if (plugin.name !== manifest.name) {
      throw new Error('Plugin name must match manifest name');
    }

    if (plugin.version !== manifest.version) {
      throw new Error('Plugin version must match manifest version');
    }
  }

  /**
   * Stellt sicher, dass das Plugin-Verzeichnis existiert
   */
  private async ensurePluginDirectory(): Promise<void> {
    try {
      await fs.access(this.pluginManager['pluginDirectory']);
    } catch (error) {
      // Verzeichnis existiert nicht, erstelle es
      await fs.mkdir(this.pluginManager['pluginDirectory'], { recursive: true });
      console.log(`[PluginLoader] Created plugin directory: ${this.pluginManager['pluginDirectory']}`);
    }
  }
}