import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  HookContext,
  HookExecutionConfig,
  HookFailure,
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
  private preCompactHooks: Array<{ name: string; execute: (payload: any, context?: HookContext) => Promise<PreToolHookResponse | null | undefined> }> = [];
  private notificationHooks: Array<{ name: string; execute: (payload: NotificationPayload, context?: HookContext) => Promise<any> }> = [];
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
  public async executePreHooks(
    toolName: string,
    params: any,
    context?: Partial<HookContext>
  ): Promise<{ blocked: boolean; reason?: string; modifiedParams: any; code?: 'HOOK_PRE_BLOCKED' | 'HOOK_PRE_FAILED'; hookName?: string }> {
    return this.executePreToolUse(toolName, params, context);
  }

  public async executePreToolUse(
    toolName: string,
    params: any,
    context?: Partial<HookContext>
  ): Promise<{ blocked: boolean; reason?: string; modifiedParams: any; code?: 'HOOK_PRE_BLOCKED' | 'HOOK_PRE_FAILED'; hookName?: string }> {
    await this.initialize();
    const hookContext = this.buildHookContext(toolName, params, context);
    const strictPreFailures = this.isHookContractV2Enabled();
    
    let currentParams = { ...params };
    
    for (const hook of this.preToolHooks) {
      const execution = await this.executeWithIsolation(
        HookType.PreToolUse,
        hook.name,
        () => hook.execute(toolName, currentParams, hookContext),
        { failOpen: !strictPreFailures }
      );
      if (!execution.ok) {
        const message = execution.error instanceof Error ? execution.error.message : String(execution.error);
        if (strictPreFailures) {
          return {
            blocked: true,
            reason: `Pre-hook failed (${hook.name}): ${message}`,
            modifiedParams: currentParams,
            code: 'HOOK_PRE_FAILED',
            hookName: hook.name
          };
        }
        this.log.error(`Error in pre-hook ${hook.name}:`, execution.error);
        continue;
      }
      const result = execution.result;
      if (!result) continue;
      if (result.blocked) {
        return {
          blocked: true,
          reason: result.reason || `Blocked by hook ${hook.name}`,
          modifiedParams: currentParams,
          code: 'HOOK_PRE_BLOCKED',
          hookName: hook.name
        };
      }
      if (result.modifiedParams) {
        currentParams = { ...currentParams, ...result.modifiedParams };
      }
    }

    return { blocked: false, modifiedParams: currentParams };
  }

  /**
   * Execute all post-tool hooks
   */
  public async executePostHooks(
    toolName: string,
    params: any,
    result: any,
    context?: Partial<HookContext>
  ): Promise<{ failures: HookFailure[] }> {
    return this.executePostToolUse(toolName, params, result, context);
  }

  public async executePostToolUse(
    toolName: string,
    params: any,
    result: any,
    context?: Partial<HookContext>
  ): Promise<{ failures: HookFailure[] }> {
    await this.initialize();
    const hookContext = this.buildHookContext(toolName, params, context);
    const failures: HookFailure[] = [];

    for (const hook of this.postToolHooks) {
      const execution = await this.executeWithIsolation(
        HookType.PostToolUse,
        hook.name,
        () => hook.execute(toolName, params, result, hookContext),
        { failOpen: true }
      );
      if (!execution.ok) {
        failures.push({
          code: 'HOOK_POST_FAILED',
          hookName: hook.name,
          message: execution.error instanceof Error ? execution.error.message : String(execution.error)
        });
        this.log.error(`Error in post-hook ${hook.name}:`, execution.error);
      }
    }
    return { failures };
  }

  public async executePreCompact(payload: any, context?: Partial<HookContext>): Promise<{ failures: HookFailure[] }> {
    await this.initialize();
    const hookContext = this.buildHookContext('PreCompact', payload, context);
    const failures: HookFailure[] = [];
    for (const hook of this.preCompactHooks) {
      const execution = await this.executeWithIsolation(
        HookType.PreCompact,
        hook.name,
        () => hook.execute(payload, hookContext),
        { failOpen: true }
      );
      if (!execution.ok) {
        failures.push({
          code: 'HOOK_POST_FAILED',
          hookName: hook.name,
          message: execution.error instanceof Error ? execution.error.message : String(execution.error)
        });
        this.log.error(`Error in pre-compact hook ${hook.name}:`, execution.error);
      }
    }
    return { failures };
  }

  public async executeNotification(
    payload: NotificationPayload,
    context?: Partial<HookContext>
  ): Promise<{ failures: HookFailure[] }> {
    await this.initialize();
    const hookContext = this.buildHookContext('Notification', payload, context);
    const failures: HookFailure[] = [];
    for (const hook of this.notificationHooks) {
      const execution = await this.executeWithIsolation(
        HookType.Notification,
        hook.name,
        () => hook.execute(payload, hookContext),
        { failOpen: true }
      );
      if (!execution.ok) {
        failures.push({
          code: 'HOOK_NOTIFICATION_FAILED',
          hookName: hook.name,
          message: execution.error instanceof Error ? execution.error.message : String(execution.error)
        });
        this.log.error(`Error in notification hook ${hook.name}:`, execution.error);
      }
    }
    return { failures };
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
    operation: () => Promise<T>,
    options: { failOpen: boolean }
  ): Promise<{ ok: true; result: T } | { ok: false; error: unknown }> {
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
      return { ok: true, result };
    } catch (error) {
      if (execConfig.logFailures) {
        this.log.event('WARN', 'hook.failed', `Hook ${hookName} failed`, {
          hookType: type,
          hookName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      if (!options.failOpen || !execConfig.catchErrors) {
        return { ok: false, error };
      }
      return { ok: false, error };
    }
  }

  private isHookContractV2Enabled(): boolean {
    const config = vscode.workspace.getConfiguration('gently');
    return config.get<boolean>('resilience.hookContractV2', true);
  }

  private buildHookContext(
    toolName: string,
    params: any,
    context?: Partial<HookContext>
  ): HookContext {
    return {
      toolName,
      params,
      workspaceRoot: this.workspaceRoot,
      flowId: context?.flowId,
      correlationId: context?.correlationId,
      subagentId: context?.subagentId,
      toolCallId: context?.toolCallId,
      attempt: context?.attempt,
      phase: context?.phase,
      mode: context?.mode
    };
  }
}
