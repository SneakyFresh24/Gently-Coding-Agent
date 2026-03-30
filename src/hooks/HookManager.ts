import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  HookExecutionConfig,
  HookType,
  NotificationPayload,
  PostToolHook,
  PreToolHook,
  PreToolHookResponse
} from './types';
import { LogService } from '../services/LogService';

/**
 * HookManager
 * Loads and executes custom hooks from .gently/hooks/
 */
export class HookManager {
  private preToolHooks: PreToolHook[] = [];
  private postToolHooks: PostToolHook[] = [];
  private preCompactHooks: Array<{ name: string; execute: (payload: any) => Promise<PreToolHookResponse | null | undefined> }> = [];
  private notificationHooks: Array<{ name: string; execute: (payload: NotificationPayload) => Promise<any> }> = [];
  private hooksInitialized: boolean = false;
  private readonly log = new LogService('HookManager');

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

      const normalizedType = this.normalizeHookType(hook.type);
      if (!normalizedType) {
        this.log.warn(`Unknown hook type in ${filePath}: ${String(hook.type)}`);
        return;
      }

      if (normalizedType === HookType.PreToolUse) {
        this.preToolHooks.push(hook);
      } else if (normalizedType === HookType.PostToolUse) {
        this.postToolHooks.push(hook);
      } else if (normalizedType === HookType.PreCompact) {
        this.preCompactHooks.push({
          name: hook.name,
          execute: (payload: any) => hook.execute('PreCompact', payload)
        });
      } else if (normalizedType === HookType.Notification) {
        this.notificationHooks.push({
          name: hook.name,
          execute: (payload: NotificationPayload) => hook.execute('Notification', payload)
        });
      }
      
      this.log.info(`Loaded ${normalizedType} hook: ${hook.name}`);
    } catch (error) {
      console.error(`[HookManager] Error loading hook ${filePath}:`, error);
    }
  }

  /**
   * Execute all pre-tool hooks
   */
  public async executePreHooks(toolName: string, params: any): Promise<{ blocked: boolean; reason?: string; modifiedParams: any }> {
    return this.executePreToolUse(toolName, params);
  }

  public async executePreToolUse(toolName: string, params: any): Promise<{ blocked: boolean; reason?: string; modifiedParams: any }> {
    await this.initialize();
    
    let currentParams = { ...params };
    
    for (const hook of this.preToolHooks) {
      try {
        const result = await this.executeWithIsolation(
          HookType.PreToolUse,
          hook.name,
          () => hook.execute(toolName, currentParams)
        );
        if (result) {
          if (result.blocked) {
            return { blocked: true, reason: result.reason, modifiedParams: currentParams };
          }
          if (result.modifiedParams) {
            currentParams = { ...currentParams, ...result.modifiedParams };
          }
        }
      } catch (error) {
        this.log.error(`Error in pre-hook ${hook.name}:`, error);
      }
    }

    return { blocked: false, modifiedParams: currentParams };
  }

  /**
   * Execute all post-tool hooks
   */
  public async executePostHooks(toolName: string, params: any, result: any): Promise<void> {
    return this.executePostToolUse(toolName, params, result);
  }

  public async executePostToolUse(toolName: string, params: any, result: any): Promise<void> {
    await this.initialize();

    for (const hook of this.postToolHooks) {
      try {
        await this.executeWithIsolation(
          HookType.PostToolUse,
          hook.name,
          () => hook.execute(toolName, params, result)
        );
      } catch (error) {
        this.log.error(`Error in post-hook ${hook.name}:`, error);
      }
    }
  }

  public async executePreCompact(payload: any): Promise<void> {
    await this.initialize();
    for (const hook of this.preCompactHooks) {
      try {
        await this.executeWithIsolation(
          HookType.PreCompact,
          hook.name,
          () => hook.execute(payload)
        );
      } catch (error) {
        this.log.error(`Error in pre-compact hook ${hook.name}:`, error);
      }
    }
  }

  public async executeNotification(payload: NotificationPayload): Promise<void> {
    await this.initialize();
    for (const hook of this.notificationHooks) {
      try {
        await this.executeWithIsolation(
          HookType.Notification,
          hook.name,
          () => hook.execute(payload)
        );
      } catch (error) {
        this.log.error(`Error in notification hook ${hook.name}:`, error);
      }
    }
  }

  private normalizeHookType(rawType: unknown): HookType | null {
    if (rawType === 'pre') return HookType.PreToolUse;
    if (rawType === 'post') return HookType.PostToolUse;
    if (rawType === HookType.PreToolUse || rawType === HookType.PostToolUse || rawType === HookType.PreCompact || rawType === HookType.Notification) {
      return rawType;
    }
    return null;
  }

  private getExecutionConfig(): HookExecutionConfig {
    const config = vscode.workspace.getConfiguration('gently');
    return {
      timeoutMs: Math.max(500, Number(config.get<number>('hooks.timeoutMs', 5000) || 5000)),
      maxMemoryMB: Math.max(8, Number(config.get<number>('hooks.maxMemoryMB', 50) || 50)),
      catchErrors: config.get<boolean>('hooks.catchErrors', true),
      logFailures: config.get<boolean>('hooks.logFailures', true)
    };
  }

  private async executeWithIsolation<T>(
    type: HookType,
    hookName: string,
    operation: () => Promise<T>
  ): Promise<T | undefined> {
    const execConfig = this.getExecutionConfig();
    const beforeMemory = process.memoryUsage().heapUsed;

    const timedOperation = Promise.race<T>([
      operation(),
      new Promise<T>((_, reject) => {
        setTimeout(() => reject(new Error(`hook_timeout_${execConfig.timeoutMs}ms`)), execConfig.timeoutMs);
      })
    ]);

    try {
      const result = await timedOperation;
      const afterMemory = process.memoryUsage().heapUsed;
      const deltaMb = (afterMemory - beforeMemory) / (1024 * 1024);
      if (deltaMb > execConfig.maxMemoryMB) {
        throw new Error(`hook_memory_limit_exceeded_${deltaMb.toFixed(2)}MB`);
      }
      return result;
    } catch (error) {
      if (execConfig.logFailures) {
        this.log.event('WARN', 'hook.failed', `Hook ${hookName} failed`, {
          hookType: type,
          hookName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      if (!execConfig.catchErrors) {
        throw error;
      }
      return undefined;
    }
  }
}
