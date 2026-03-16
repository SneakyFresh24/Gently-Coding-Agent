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
import { SessionManager } from './session/SessionManager';
import { CommandRegistry } from './commands/CommandRegistry';
import { PluginManager, PluginLoader } from './plugins';
import { ModeService } from './modes';
import { GuardianIntegration } from './guardian/GuardianIntegration';
import { ApiKeyManager } from './services/ApiKeyManager';
import { OpenRouterService } from './services/OpenRouterService';

let chatViewProvider: ChatViewProvider;
let agentManager: AgentManager;
let sessionManager: SessionManager;
let pluginManager: PluginManager;
let modeService: ModeService;
let guardianIntegration: GuardianIntegration;
let apiKeyManager: ApiKeyManager;
let openRouterService: OpenRouterService;
let isWebviewProviderRegistered = false;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Gently AI Coding Agent is now active! (BYOK / OpenRouter + DI mode)');

  // ── BYOK services ──────────────────────────────────────────────────────────
  apiKeyManager = new ApiKeyManager(context.secrets);
  openRouterService = new OpenRouterService(apiKeyManager);

  // ── DI Container (neu) ─────────────────────────────────────────────────────
  const container = new Container();
  configureServices(container, context);

  // ── Session manager ────────────────────────────────────────────────────────
  sessionManager = new SessionManager(context);
  container.force('agentSessions', sessionManager);

  // ── Plugin system ─────────────────────────────────────────────────────────
  pluginManager = new PluginManager(sessionManager, container.resolve('toolRegistry'));
  const pluginLoader = new PluginLoader(pluginManager);
  await pluginLoader.loadPlugins();

  // ── Agent manager (jetzt mit Container) ────────────────────────────────────
  agentManager = new AgentManager(context);

  // ── Mode service ──────────────────────────────────────────────────────────
  modeService = new ModeService(context);

  // ── Agent initialization ──────────────────────────────────────────────────
  try {
    await agentManager.initialize();
  } catch (err) {
    console.error('Failed to initialize agent:', err);
  }

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

  // ── Guardian chat bridge ──────────────────────────────────────────────────
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


  // ── Guardian integration ──────────────────────────────────────────────────
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      agentLogger.info('Starting Guardian initialization...', 'Extension');

      // Resolve deps from the DI container
      const memoryManager = agentManager.baseMemoryManager;
      const validationManager = agentManager.validationManager;
      const codebaseIndexer = container.resolve<any>('indexer');
      const hybridRetriever = container.resolve<any>('hybridRetriever');

      if (!memoryManager) {
        agentLogger.error('CRITICAL: memoryManager is undefined – skipping Guardian', null, 'Extension');
      } else {
        const { RelationshipGraph } = await import('./agent/graph/RelationshipGraph');
        const relationshipGraph = new RelationshipGraph({ workspaceRoot });

        guardianIntegration = new GuardianIntegration(
          workspaceRoot,
          relationshipGraph,
          memoryManager,
          validationManager as any,
          hybridRetriever,
          codebaseIndexer,
          agentManager,
          context.extensionUri
        );

        await guardianIntegration.initialize();

        const gs = guardianIntegration.getGuardianService();
        if (gs) {
          agentManager.setGuardianService(gs);
        }
        context.subscriptions.push(guardianIntegration);
        
        agentLogger.info('Guardian integration initialized successfully ✓', 'Extension');
      }
    }
  } catch (error) {
    agentLogger.error('FAILED to initialize Guardian integration', error, 'Extension');
  }
}

export async function deactivate() {
  console.log('Gently AI Coding Agent is now deactivated');

  // Flush pending disk writes
  if (sessionManager) {
    try {
      await sessionManager.flush();
    } catch (err) {
      console.error('Failed to flush sessions during deactivation:', err);
    }
  }

  if (agentManager) agentManager.dispose();
  if (guardianIntegration) guardianIntegration.dispose();
}
