// =====================================================
// Gently - AI Coding Agent - Main Extension Entry Point (DI Version)
// BYOK Edition: OpenRouter, no account required
// =====================================================

import * as vscode from 'vscode';
import { ChatViewProvider } from './views/chat/ChatViewProvider';
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

  // ── Agent initialization ──────────────────────────────────────────────────
  agentManager.initialize().catch(err => {
    console.error('Failed to initialize agent:', err);
  });

  // ── Guardian integration ──────────────────────────────────────────────────
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const workspaceRoot = workspaceFolders[0].uri.fsPath;
      console.log('[Guardian Init] Starting Guardian initialization...');

      const { RelationshipGraph } = await import('./agent/graph/RelationshipGraph');

      // Resolve deps from the DI container (not from AgentManager properties)
      const memoryManager = agentManager.baseMemoryManager;
      const validationManager = agentManager.validationManager;

      // 'indexer' is the DI key for CodebaseIndexer (see ServiceProvider.ts)
      const codebaseIndexer = container.resolve<any>('indexer');
      const hybridRetriever = container.resolve<any>('hybridRetriever');

      console.log('[Guardian Init] Dependencies resolved:', {
        memoryManager: !!memoryManager,
        validationManager: !!validationManager,
        codebaseIndexer: !!codebaseIndexer,
        hybridRetriever: !!hybridRetriever
      });

      if (!memoryManager) {
        console.error('[Guardian Init] CRITICAL: memoryManager is undefined – skipping Guardian');
      } else {
        const relationshipGraph = new RelationshipGraph({ workspaceRoot });

        guardianIntegration = new GuardianIntegration(
          workspaceRoot,
          relationshipGraph,
          memoryManager,
          validationManager as any, // may be undefined – GuardianService handles gracefully
          hybridRetriever,
          codebaseIndexer,
          agentManager,
          context.extensionUri
        );

        // GuardianIntegration.initialize() already registers the webview provider internally
        await guardianIntegration.initialize();

        const gs = guardianIntegration.getGuardianService();
        if (gs) {
          agentManager.setGuardianService(gs);
        }
        context.subscriptions.push(guardianIntegration);
        (global as any).guardianIntegration = guardianIntegration;

        console.log('[Guardian Init] Guardian integration initialized successfully ✓');
      }
    } else {
      console.log('[Guardian Init] No workspace folders – Guardian skipped');
    }
  } catch (error) {
    console.error('[Guardian Init] FAILED to initialize Guardian integration:', error);
  }
}

export function deactivate() {
  console.log('Gently AI Coding Agent is now deactivated');
  if (agentManager) agentManager.dispose();
  if (guardianIntegration) guardianIntegration.dispose();
}
