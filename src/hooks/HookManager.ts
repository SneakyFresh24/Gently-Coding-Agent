import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PreToolHook, PostToolHook, PreToolHookResponse } from './types';

/**
 * HookManager
 * Loads and executes custom hooks from .gently/hooks/
 */
export class HookManager {
  private preHooks: PreToolHook[] = [];
  private postHooks: PostToolHook[] = [];
  private hooksInitialized: boolean = false;

  constructor(private workspaceRoot: string) {}

  /**
   * Initialize hooks by scanning the .gently/hooks directory
   */
  public async initialize(): Promise<void> {
    if (this.hooksInitialized) return;

    const hooksDir = path.join(this.workspaceRoot, '.gently', 'hooks');
    if (!fs.existsSync(hooksDir)) {
      this.hooksInitialized = true;
      return;
    }

    try {
      const files = fs.readdirSync(hooksDir);
      for (const file of files) {
        if (file.endsWith('.js') || file.endsWith('.ts')) {
          await this.loadHook(path.join(hooksDir, file));
        }
      }
    } catch (error) {
      console.error('[HookManager] Failed to load hooks:', error);
    }

    this.hooksInitialized = true;
  }

  /**
   * Dynamically load a hook file
   */
  private async loadHook(filePath: string): Promise<void> {
    try {
      // Note: In a real VS Code extension, dynamic loading might require 
      // careful handling of require/import especially for TS files.
      // For this implementation, we assume they are compatible JS/TS files.
      const hookModule = await import(filePath);
      const hook = hookModule.default;

      if (!hook || !hook.name || !hook.type || typeof hook.execute !== 'function') {
        console.warn(`[HookManager] Invalid hook format in ${filePath}`);
        return;
      }

      if (hook.type === 'pre') {
        this.preHooks.push(hook);
      } else if (hook.type === 'post') {
        this.postHooks.push(hook);
      }
      
      console.log(`[HookManager] Loaded ${hook.type}-hook: ${hook.name}`);
    } catch (error) {
      console.error(`[HookManager] Error loading hook ${filePath}:`, error);
    }
  }

  /**
   * Execute all pre-tool hooks
   */
  public async executePreHooks(toolName: string, params: any): Promise<{ blocked: boolean; reason?: string; modifiedParams: any }> {
    await this.initialize();
    
    let currentParams = { ...params };
    
    for (const hook of this.preHooks) {
      try {
        const result = await hook.execute(toolName, currentParams);
        if (result) {
          if (result.blocked) {
            return { blocked: true, reason: result.reason, modifiedParams: currentParams };
          }
          if (result.modifiedParams) {
            currentParams = { ...currentParams, ...result.modifiedParams };
          }
        }
      } catch (error) {
        console.error(`[HookManager] Error in pre-hook ${hook.name}:`, error);
      }
    }

    return { blocked: false, modifiedParams: currentParams };
  }

  /**
   * Execute all post-tool hooks
   */
  public async executePostHooks(toolName: string, params: any, result: any): Promise<void> {
    await this.initialize();

    for (const hook of this.postHooks) {
      try {
        await hook.execute(toolName, params, result);
      } catch (error) {
        console.error(`[HookManager] Error in post-hook ${hook.name}:`, error);
      }
    }
  }
}
