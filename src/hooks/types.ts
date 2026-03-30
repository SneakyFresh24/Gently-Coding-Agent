/**
 * Hook System Types
 * Defines the structure for custom user hooks.
 */

export interface HookContext {
  toolName: string;
  params: any;
  workspaceRoot: string;
}

export enum HookType {
  PreToolUse = 'PreToolUse',
  PostToolUse = 'PostToolUse',
  PreCompact = 'PreCompact',
  Notification = 'Notification'
}

export type NotificationChannel =
  | 'circuit_breaker'
  | 'loop_escalation'
  | 'recovery'
  | 'compaction';

export interface NotificationPayload {
  channel: NotificationChannel;
  severity: 'info' | 'warning' | 'error';
  action?: 'retry' | 'abort' | 'wait';
  retryAfter?: number;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface HookExecutionConfig {
  timeoutMs: number;
  maxMemoryMB: number;
  catchErrors: boolean;
  logFailures: boolean;
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
  type: 'pre' | 'post' | HookType;
  execute: (toolName: string, params: any, extra?: any) => Promise<any>;
}

export interface PreToolHook extends GenericHook {
  type: 'pre' | HookType.PreToolUse;
  execute: (toolName: string, params: any) => Promise<PreToolHookResponse | null | undefined>;
}

export interface PostToolHook extends GenericHook {
  type: 'post' | HookType.PostToolUse;
  execute: (toolName: string, params: any, result: any) => Promise<PostToolHookResponse | null | undefined>;
}

export interface PreCompactHook extends GenericHook {
  type: HookType.PreCompact;
  execute: (_toolName: string, params: any) => Promise<PreToolHookResponse | null | undefined>;
}

export interface NotificationHook extends GenericHook {
  type: HookType.Notification;
  execute: (_toolName: string, params: NotificationPayload) => Promise<PostToolHookResponse | null | undefined>;
}
