// =====================================================
// Chat View Provider – BYOK Edition (no auth)
// =====================================================

import * as vscode from 'vscode';
import { ApiKeyManager } from '../../services/ApiKeyManager';
import { OpenRouterService } from '../../services/OpenRouterService';
import { AgentManager } from '../../agent/agentManager/AgentManager';
import { FileReferenceManager, FileReference } from '../../agent/fileReferenceManager';
import { generateHtml } from '../webview/htmlGenerator';
import { TerminalManager } from '../../terminal';
import { ModeService } from '../../modes';

import { MessageHandler } from './handlers/MessageHandler';
import { SessionHandler } from './handlers/SessionHandler';
import { WebviewMessageHandler } from './handlers/WebviewMessageHandler';
import { FileHandler } from './handlers/FileHandler';
import { SystemHandler } from './handlers/SystemHandler';

import { ChatViewContext, WebviewMessage } from './types/ChatTypes';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gently.chatView';
  private _view?: vscode.WebviewView;
  private isWebviewReady = false;
  
  // Queue for messages sent before the webview is ready
  private pendingMessages: any[] = [];

  private messageHandler!: MessageHandler;
  private sessionHandler!: SessionHandler;
  private webviewMessageHandler!: WebviewMessageHandler;
  private fileHandler!: FileHandler;
  private systemHandler!: SystemHandler;

  private terminalManager?: TerminalManager;
  private sessionManager: any;
  private fileReferenceManager: FileReferenceManager;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly apiKeyManager: ApiKeyManager,
    private readonly openRouterService: OpenRouterService,
    private readonly agentManager: AgentManager,
    private readonly modeService: ModeService,
    private readonly context?: vscode.ExtensionContext
  ) {
    this.fileReferenceManager = new FileReferenceManager(
      this.agentManager.getFileOperations(),
      this.agentManager.getIndexer()
    );

    this.initializeHandlersAndCallbacks();
  }

  private initializeHandlersAndCallbacks(): void {
    this.initializeHandlers();

    if (this.context) {
      this.initializeTerminalManager(this.context);
    }

    this.setupEventCallbacks();
    this.agentManager.setCurrentModeProvider(() => this.modeService.getCurrentMode()?.id);
  }

  private initializeHandlers(): void {
    if (!this.context) throw new Error('Extension context is required for ChatViewProvider');

    // CRITICAL: Create and inject SessionManager FIRST, before MessageHandler!
    // MessageHandler → SessionHistoryManager reads sessionManager from DI on construction.
    // If we inject it after MessageHandler is created, it's already too late (returns undefined).
    this.sessionManager = this.createSessionManager();

    this.sessionHandler = new SessionHandler(
      this.sessionManager,
      (message: any) => this.sendMessageToWebview(message)
    );

    this.messageHandler = new MessageHandler(
      this.context,
      this.openRouterService,
      this.agentManager,
      this.modeService,
      (message: any) => this.sendMessageToWebview(message),
      (message: any) => {
        // 1. Runtime-History update (crucial for tool sequence continuity)
        const context = this.messageHandler.getContext();
        context.conversationHistory.push(message);

        // 2. Persistent storage update (for session recovery)
        this.messageHandler.getSessionManager().saveMessageToHistory(message).catch(e =>
          console.error('[ChatViewProvider] Failed to save conversation history message:', e)
        );

        // 3. UI Update
        this.sendContextUpdate();
      }
    );

    this.fileHandler = new FileHandler(
      this.agentManager,
      this.fileReferenceManager,
      (message: any) => this.sendMessageToWebview(message)
    );

    this.systemHandler = new SystemHandler(
      this.agentManager,
      (message: any) => this.sendMessageToWebview(message)
    );

    this.webviewMessageHandler = new WebviewMessageHandler(
      this.messageHandler,
      this.sessionHandler,
      this.fileHandler,
      this.systemHandler,
      this.apiKeyManager,
      this.openRouterService,
      (message: any) => this.sendMessageToWebview(message)
    );
  }

  private createSessionManager() {
    if (!this.context) throw new Error('Extension context is required');
    const { SessionManager } = require('../../session/SessionManager');
    const sessionManager = new SessionManager(this.context);
    
    // Inject the session manager into the AgentManager's DI container 
    // so handlers can correctly resolve it.
    try {
      const containerObj = (this.agentManager as any).container;
      if (containerObj) {
        containerObj.force('sessionManager', sessionManager);
      }
    } catch (e) {
      console.error('[ChatViewProvider] Failed to inject SessionManager into DI container', e);
    }
    
    return sessionManager;
  }

  private initializeTerminalManager(context: vscode.ExtensionContext): void {
    this.terminalManager = new TerminalManager(
      context,
      (message: any) => this.sendMessageToWebview(message)
    );
    this.agentManager.setTerminalManager(this.terminalManager);
  }

  private setupEventCallbacks(): void {
    this.agentManager.setEventCallback((event: any) => {
      // If the webview is not ready, buffer the message
      if (!this._view) {
        console.log('[ChatViewProvider] Webview not ready, queuing event:', event.type);
        this.pendingMessages.push(event);
        return;
      }

      this.sendMessageToWebview(event);

      // Link plan to session if it's a new plan
      if (event.type === 'planCreated' && event.plan?.id) {
        this.sessionHandler.updateSessionWithPlan(event.plan.id).catch(err => {
          console.error('[ChatViewProvider] Failed to update session with plan:', err);
        });
      }

      // Handle automatic handover from Architect to Coder
      if (event.type === 'handover_to_coder') {
        console.log('[ChatViewProvider] Handover detected - Switching to Code mode');
        this.setSelectedMode('code').then(() => {
          if (event.planId) {
            const planMessage = event.message || 'Executing plan...';
            this.messageHandler.sendMessage(`${planMessage}\n\n(Execute Plan ID: ${event.planId})`, true);
          }
        }).catch(err => {
          console.error('[ChatViewProvider] Failed to handle handover:', err);
        });
      }
    });

    this.agentManager.onIndexUpdate(() => {
      if (this._view) this.sendContextUpdate();
    });

    this.agentManager.setValidationMessageCallback((message: any) => {
      this.sendMessageToWebview(message);
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    try {
      this._view = webviewView;

      webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
      };

      webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

      // Flush pending messages if any
      if (this.pendingMessages.length > 0) {
        console.log(`[ChatViewProvider] Flushing ${this.pendingMessages.length} pending messages to webview`);
        for (const msg of this.pendingMessages) {
          webviewView.webview.postMessage(msg);
        }
        this.pendingMessages = [];
      }


      webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
        try {
          if (data.type === 'ready') {
            await this.initializeWebviewData();
            return;
          }
          if (data.type === 'modeChanged' || data.type === 'setMode') {
            await this.setSelectedMode(data.modeId);
            return;
          }
          if (data.type === 'commandApprovalResponse') {
            await this.handleCommandApprovalResponse(data.commandId, data.response);
            return;
          }
          if (data.type === 'toolApprovalResponse') {
            this.agentManager.getToolManager().handleApprovalResponse(data.approvalId, data.approved);
            return;
          }
          await this.webviewMessageHandler.handleMessage(data, this._view!);
        } catch (error: any) {
          console.error('[ChatViewProvider] Error handling webview message:', error);
        }
      });

      // Safety Fallback: Initialize after 5 seconds if 'ready' msg was missed
      setTimeout(() => {
        if (this._view && !this.isWebviewReady) {
          console.warn('[ChatViewProvider] Webview ready timeout → initializing data anyway');
          this.initializeWebviewData();
        }
      }, 5000);
    } catch (error: any) {
      console.error('[ChatViewProvider] Error resolving webview view:', error);
      vscode.window.showErrorMessage(`Failed to initialize chat view: ${error.message}`);
    }
  }

  private async initializeWebviewData(): Promise<void> {
    if (this.isWebviewReady) return;
    this.isWebviewReady = true;
    console.log('[ChatViewProvider] Initializing webview data');
    
    await this.sendApiKeyStatus();
    await this.sendContextUpdate();
    await this.sessionHandler.handleGetSessions();
  }

  private async sendApiKeyStatus(): Promise<void> {
    const hasKey = await this.apiKeyManager.hasKey();
    this.sendMessageToWebview({ type: 'apiKeyStatus', hasKey });
  }

  private async sendContextUpdate(): Promise<void> {
    if (!this._view) return;
    const files = this.agentManager.getTrackedFiles();
    const stats = this.agentManager.getContextStats();

    // Add estimated token count from conversation history
    const context = this.getContext();
    if (context && context.conversationHistory) {
      const historyTokens = Math.ceil(
        context.conversationHistory.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 4
      );
      stats.totalTokens += historyTokens;
      stats.utilizationPercent = Math.min(100, Math.round((stats.totalTokens / stats.maxTokens) * 100));
    }

    this._view.webview.postMessage({ type: 'contextUpdate', files, stats });
  }

  private sendMessageToWebview(message: any): void {
    if (this._view) this._view.webview.postMessage(message);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  public refresh(): void {
    if (this._view) {
      this._view.webview.html = this._getHtmlForWebview(this._view.webview);
      this.sendApiKeyStatus();
    }
  }

  public clearHistory(): void {
    this.messageHandler.clearHistory();
    this.sendContextUpdate();
  }
  public getContext(): ChatViewContext { return this.messageHandler.getContext(); }

  public setAgentMode(enabled: boolean): void {
    this.messageHandler.setSelectedMode(enabled ? 'agent' : 'ask');
    this.context?.globalState.update('gently.agentMode', enabled);
  }

  public setSelectedModel(model: string): void {
    this.messageHandler.setSelectedModel(model);
    this.context?.globalState.update('gently.selectedModel', model);
  }

  /** Modes that behave like an agent (have tools, can execute) */
  private static readonly AGENT_LIKE_MODES = ['agent', 'code', 'debug'];

  public async setSelectedMode(modeId: string): Promise<void> {
    this.messageHandler.setSelectedMode(modeId);
    if (!this.modeService) return;
    try {
      await this.modeService.setMode(modeId);
      const mode = this.modeService.getCurrentMode();
      if (mode) {
        // NEVER overwrite the real mode.id — pass it through directly!
        const isAgentMode = ChatViewProvider.AGENT_LIKE_MODES.includes(mode.id);
        this.messageHandler.setSelectedMode(mode.id);
        this.context?.globalState.update('gently.agentMode', isAgentMode);
        console.log(`[ChatViewProvider] setSelectedMode: ${modeId} → resolved to ${mode.id} (agentLike=${isAgentMode})`);
        this._view?.webview.postMessage({
          type: 'modeChanged', modeId: mode.id, modeName: mode.displayName,
          modeDescription: mode.description, agentMode: isAgentMode,
        });
      }
    } catch (error: any) {
      this._view?.webview.postMessage({ type: 'error', message: `Error switching mode: ${error.message}` });
    }
  }

  public stopMessage(): void { this.messageHandler.stopMessage(); }

  public async addFileReference(fileRef: FileReference): Promise<void> {
    await this.fileHandler.addFileReference(fileRef);
  }

  public async handleOpenFile(filePath: string): Promise<void> { await this.fileHandler.handleOpenFile(filePath); }
  public async handleSearchFiles(query: string): Promise<void> { await this.fileHandler.handleSearchFiles(query); }
  public async handleOpenFilePicker(): Promise<void> { await this.fileHandler.handleOpenFilePicker(); }
  public async handleRequestFilePreview(filePath: string): Promise<void> { await this.fileHandler.handleRequestFilePreview(filePath); }
  public async handleGetValidationMetrics(): Promise<void> { await this.systemHandler.handleGetValidationMetrics(); }
  public async handleEnhancePrompt(prompt: string): Promise<void> { await this.systemHandler.handleEnhancePrompt(prompt); }
  public async handleGetSessions(): Promise<void> { await this.sessionHandler.handleGetSessions(); }
  public async handleNewSession(): Promise<void> { await this.sessionHandler.handleNewSession(); }
  public async handleSwitchSession(sessionId: string): Promise<void> { await this.sessionHandler.handleSwitchSession(sessionId); }
  public async handleSessionAction(action: string, sessionId: string, payload?: any): Promise<void> { await this.sessionHandler.handleSessionAction(action, sessionId, payload); }
  public async handleSearchSessions(query: string): Promise<void> { await this.sessionHandler.handleSearchSessions(query); }

  public async handleCommandApprovalResponse(commandId: string, response: 'accept' | 'accept_always' | 'deny'): Promise<void> {
    const terminalManager = this.agentManager.getTerminalManager();
    if (terminalManager) {
      terminalManager.handleApprovalResponse(commandId, response);
    }
  }
  public async handleKillCommand(commandId: string): Promise<void> {
    const killed = this.terminalManager?.killCommand(commandId) ?? false;
    this._view?.webview.postMessage({ type: 'commandKilled', commandId, success: killed });
  }

  public async handleSetTerminalMode(mode: 'manual' | 'smart'): Promise<void> {
    this.terminalManager?.setTerminalMode(mode);
  }

  public async handleToggleQuickPattern(name: string, enabled: boolean): Promise<void> {
    this.terminalManager?.toggleQuickPattern(name, enabled);
  }

  public async handleRevertCheckpoint(checkpointId: string, messageId: string): Promise<void> {
    try {
      const checkpoint = this.agentManager.getCheckpointManager().getCheckpointForMessage(messageId);
      const checkpointNumber = checkpoint?.checkpointNumber || 0;
      const result = await this.agentManager.restoreCheckpoint(checkpointId);

      if (result.success) {
        const filesCount = result.filesRestored.length;
        const msg = `Checkpoint ${checkpointNumber} restored • ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`;
        vscode.window.showInformationMessage(`✅ ${msg}`);
        this._view?.webview.postMessage({ type: 'systemMessage', content: msg });
        this._view?.webview.postMessage({ type: 'checkpointRestored', checkpointId, messageId, checkpointNumber, filesRestored: result.filesRestored });
      } else {
        const err = result.errors?.join(', ') || 'Unknown error';
        vscode.window.showErrorMessage(`Failed to revert checkpoint: ${err}`);
        this._view?.webview.postMessage({ type: 'checkpointRestoreError', checkpointId, messageId, error: err });
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to revert checkpoint: ${error.message}`);
    }
  }

  public sendPromptToChat(prompt: string): void {
    this._view?.webview.postMessage({ type: 'setPromptFromGuardian', prompt });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return generateHtml(webview, this._extensionUri);
  }

  public dispose(): void {
    this.terminalManager?.dispose();
  }
}