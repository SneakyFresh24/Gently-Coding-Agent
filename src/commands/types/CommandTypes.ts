// =====================================================
// Command Types - Type definitions for command handlers
// =====================================================

import * as vscode from 'vscode';
import { ApiKeyManager } from '../../services/ApiKeyManager';
import { OpenRouterService } from '../../services/OpenRouterService';
import { ChatViewProvider } from '../../views/chat/ChatViewProvider';
import { AgentManager } from '../../agent/agentManager/AgentManager';
import { ModeService } from '../../modes';

export interface CommandHandler {
  command: string;
  handler: (...args: any[]) => Promise<void> | void;
}

export interface CommandContext {
  extensionContext: vscode.ExtensionContext;
  apiKeyManager: ApiKeyManager;
  openRouterService: OpenRouterService;
  chatViewProvider: ChatViewProvider;
  agentManager: AgentManager;
  modeService: ModeService;
}

export interface CommandRegistrationOptions {
  context: CommandContext;
  subscriptions: vscode.Disposable[];
}

export interface FileReference {
  type: 'file' | 'folder';
  path: string;
  displayName: string;
  size?: number;
}

export interface SettingsMenuOption {
  label: string;
  value: string;
}

export interface FileSearchResult {
  filePath: string;
  score: number;
  reason: string;
}

export interface FileSearchQuickPickItem extends vscode.QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
}