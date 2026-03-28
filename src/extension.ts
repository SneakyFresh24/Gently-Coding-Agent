// =====================================================
// Gently - AI Coding Agent - Main Extension Entry Point (DI Version)
// BYOK Edition: OpenRouter, no account required
// =====================================================

import * as vscode from 'vscode';
import { ChatViewProvider } from './views/chat/ChatViewProvider';
import { Logger, agentLogger } from './utils/Logger';
import { AgentManager } from './agent/agentManager/AgentManager';
import { Container } from './agent/container';
import { configureServices } from './agent/ServiceProvider';
import { initializeCommands, CommandContext } from './commands';
import { HistoryManager } from './services/HistoryManager';
import { CommandRegistry } from './commands/CommandRegistry';
import { PluginManager, PluginLoader } from './plugins';
import { ModeService } from './modes';
import { ApiKeyManager } from './services/ApiKeyManager';
import { OpenRouterService } from './services/OpenRouterService';

let chatViewProvider: ChatViewProvider;
let agentManager: AgentManager;
let historyManager: HistoryManager;
let pluginManager: PluginManager;
let modeService: ModeService;
let apiKeyManager: ApiKeyManager;
let openRouterService: OpenRouterService;
let isWebviewProviderRegistered = false;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Gently AI Coding Agent is now active! (BYOK / OpenRouter + DI mode)');

  // ── BYOK services ──────────────────────────────────────────────────────────
  apiKeyManager = new ApiKeyManager(context.secrets);
  // ── DI Container (neu) ─────────────────────────────────────────────────────
  const container = new Container();
  configureServices(container, context);

  openRouterService = new OpenRouterService(apiKeyManager);

  // ── History manager ────────────────────────────────────────────────────────
  historyManager = new HistoryManager(context);
  container.force('agentSessions', historyManager);

  // ── Plugin system ─────────────────────────────────────────────────────────
  pluginManager = new PluginManager(historyManager as any, container.resolve('toolRegistry'));
  const pluginLoader = new PluginLoader(pluginManager);
  await pluginLoader.loadPlugins();

  // ── Agent manager (jetzt mit Container) ────────────────────────────────────
  agentManager = new AgentManager(context);
  agentManager.bindOpenRouterService(openRouterService);

  // ── Mode service ──────────────────────────────────────────────────────────
  modeService = new ModeService(context);

  // ── Agent initialization ──────────────────────────────────────────────────
  try {
    await agentManager.initialize();
    await agentManager.initializeValidation(openRouterService);
  } catch (err) {
    console.error('Failed to initialize agent:', err);
  }

  const memoryBankWatcher = vscode.workspace.createFileSystemWatcher('**/.gently/memory-bank/*.md');
  const invalidateMemoryBankCache = () => {
    try {
      agentManager.invalidateMemoryBankCache();
    } catch (error) {
      console.warn('[extension] Failed to invalidate memory-bank cache:', error);
    }
  };
  context.subscriptions.push(
    memoryBankWatcher,
    memoryBankWatcher.onDidChange(invalidateMemoryBankCache),
    memoryBankWatcher.onDidCreate(invalidateMemoryBankCache),
    memoryBankWatcher.onDidDelete(invalidateMemoryBankCache)
  );

  // ── Chat view provider ────────────────────────────────────────────────────
  chatViewProvider = new ChatViewProvider(
    context.extensionUri,
    apiKeyManager,
    openRouterService,
    agentManager,
    modeService,
    context
  );

  if (!isWebviewProviderRegistered) {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider('gently.chatView', chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true }
      })
    );
    isWebviewProviderRegistered = true;
  }

  // ── Commands ──────────────────────────────────────────────────────────────
  const commandContext: CommandContext = {
    extensionContext: context,
    apiKeyManager,
    openRouterService,
    chatViewProvider,
    agentManager,
    modeService,
  };

  initializeCommands(commandContext);

  const applyRuntimeSettings = async (): Promise<void> => {
    const config = vscode.workspace.getConfiguration('gently');
    const configuredMode = config.get<boolean>('agentMode', false) ? 'code' : 'architect';
    const configuredModel = config.get<string>('selectedModel', '');
    const validationEnabled = config.get<boolean>('validation.enabled', true);
    const validationStrict = config.get<boolean>('validation.strictMode', false);

    await chatViewProvider.setSelectedMode(configuredMode);
    if (configuredModel?.trim()) {
      chatViewProvider.setSelectedModel(configuredModel.trim());
    }
    agentManager.applyValidationConfiguration(validationEnabled, validationStrict);
  };

  await applyRuntimeSettings();

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (
      event.affectsConfiguration('gently.agentMode') ||
      event.affectsConfiguration('gently.selectedModel') ||
      event.affectsConfiguration('gently.validation.enabled') ||
      event.affectsConfiguration('gently.validation.strictMode')
    ) {
      await applyRuntimeSettings();
    }
  }));

  // ── Chat bridge ───────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('gently.chat.sendPrompt', async (prompt: string) => {
      try {
        chatViewProvider.sendPromptToChat(prompt);
        await vscode.commands.executeCommand('gently.chatView.focus');
        return true;
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to send prompt: ${error}`);
        return false;
      }
    })
  );

}

export async function deactivate() {
  console.log('Gently AI Coding Agent is now deactivated');

  // Flush pending disk writes
  if (historyManager) {
    try {
      await historyManager.flush();
    } catch (err) {
      console.error('Failed to flush history during deactivation:', err);
    }
  }

  if (agentManager) agentManager.dispose();
}
