/**
 * Hook System Types
 * Defines the structure for custom user hooks.
 */

export interface HookContext {
  toolName: string;
  params: any;
  workspaceRoot: string;
}

export interface PreToolHookResponse {
  blocked?: boolean;
  reason?: string;
  modifiedParams?: any;
}

export interface PostToolHookResponse {
  // Post-hooks are generally for side effects, but could provide feedback
  feedback?: string;
}

export interface GenericHook {
  name: string;
  type: 'pre' | 'post';
  execute: (toolName: string, params: any, extra?: any) => Promise<any>;
}

export interface PreToolHook extends GenericHook {
  type: 'pre';
  execute: (toolName: string, params: any) => Promise<PreToolHookResponse | null | undefined>;
}

export interface PostToolHook extends GenericHook {
  type: 'post';
  execute: (toolName: string, params: any, result: any) => Promise<PostToolHookResponse | null | undefined>;
}
