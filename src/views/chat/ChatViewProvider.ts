// =====================================================
// Chat View Provider – BYOK Edition (no auth)
// =====================================================

import * as vscode from 'vscode';
import { ApiKeyManager } from '../../services/ApiKeyManager';
import { OpenRouterService } from '../../services/OpenRouterService';
import { AgentManager } from '../../agent/agentManager/AgentManager';
import { FileReferenceManager, FileReference } from '../../agent/fileReferenceManager';
import { HistoryManager } from '../../services/HistoryManager';
import { generateHtml } from '../webview/htmlGenerator';
import { TerminalManager } from '../../terminal';
import { ModeService } from '../../modes';

import { MessageHandler } from './handlers/MessageHandler';
import { SessionHandler } from './handlers/SessionHandler';
import { WebviewMessageHandler } from './handlers/WebviewMessageHandler';
import { FileHandler } from './handlers/FileHandler';
import { SystemHandler } from './handlers/SystemHandler';
import { normalizeModeAlias } from '../../modes/ModeContractV2';
import { DiagnosticService } from '../../services/DiagnosticService';

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
  private historyManager: HistoryManager;
  private fileReferenceManager: FileReferenceManager;
  private readonly diagnosticService: DiagnosticService | null;

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

    this.historyManager = new HistoryManager(this.context!);
    this.diagnosticService = DiagnosticService.getInstance();

    this.initializeHandlersAndCallbacks();
  }

  private initializeHandlersAndCallbacks(): void {
    this.initializeHandlers();

    this.diagnosticService?.setSystemWarningEmitter((warning) => {
      this.sendMessageToWebview({
        type: 'systemMessage',
        messageId: `sys_diag_${Date.now()}`,
        content: warning.content,
        code: warning.code,
        severity: warning.severity,
        correlationId: warning.correlationId
      } as any);
    });

    if (this.context) {
      this.initializeTerminalManager(this.context);
    }

    this.setupEventCallbacks();
    this.agentManager.setCurrentModeProvider(() => this.modeService.getCurrentMode()?.id);
  }

  private initializeHandlers(): void {
    if (!this.context) throw new Error('Extension context is required for ChatViewProvider');

    // CRITICAL: Create and inject HistoryManager FIRST, before MessageHandler!
    this.historyManager = this.createHistoryManager();

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
      },
      async (modeId: string) => {
        await this.setSelectedMode(modeId);
      }
    );

    this.sessionHandler = new SessionHandler(
      this.historyManager,
      (message: any) => this.sendMessageToWebview(message),
      async (messages: any[], model: string | null) => {
        await this.messageHandler.applySessionState(messages, model);
      },
      this.openRouterService,
      () => {
        const runtimeModel = this.messageHandler.getContext()?.selectedModel;
        if (typeof runtimeModel === 'string' && runtimeModel.trim() !== '') {
          return runtimeModel;
        }
        const storedModel = this.context?.globalState.get<string | null>('gently.selectedModel', null);
        return typeof storedModel === 'string' && storedModel.trim() !== '' ? storedModel : null;
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

  private createHistoryManager() {
    if (!this.context) throw new Error('Extension context is required');
    const historyManager = new HistoryManager(this.context);
    
    // Inject the history manager into the AgentManager's DI container 
    // so handlers can correctly resolve it.
    try {
      const containerObj = (this.agentManager as any).container;
      if (containerObj) {
        containerObj.force('sessionManager', historyManager);
        containerObj.force('agentSessions', historyManager);
      }
      this.agentManager.getCheckpointManager().setSessionManager(historyManager);
    } catch (e) {
      console.error('[ChatViewProvider] Failed to inject HistoryManager into DI container', e);
    }
    
    return historyManager;
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
      const enrichedEvent = this.enrichOutboundMessage(event);
      void this.syncPlanMetadataFromEvent(enrichedEvent);
      // If the webview is not ready, buffer the message
      if (!this._view) {
        this.diagnosticService?.captureOutboundMessage(enrichedEvent);
        console.log('[ChatViewProvider] Webview not ready, queuing event:', enrichedEvent.type);
        this.pendingMessages.push(enrichedEvent);
        return;
      }

      this.sendMessageToWebview(enrichedEvent);

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
          if (data.type === 'setMode') {
            await this.setSelectedMode(data.modeId);
            return;
          }
          if (data.type === 'toggleAgentMode') {
            await this.setSelectedMode(data.enabled ? 'code' : 'architect');
            return;
          }
          if (data.type === 'commandApprovalResponse') {
            await this.handleCommandApprovalResponse(data.commandId, data.response);
            return;
          }
          if (data.type === 'toolApprovalResponse') {
            this.agentManager.getToolManager().handleApprovalResponse(data.approvalId, data.approved, data.alwaysApprove);
            return;
          }
          if (data.type === 'questionResponse') {
            this.agentManager.getToolManager().handleQuestionResponse(
              data.questionId,
              Array.isArray(data.selectedOptionIndexes) ? data.selectedOptionIndexes : [],
              data.source
            );
            return;
          }
          if (data.type === 'getTokenUsage') {
            await this.sessionHandler.sendActiveSessionTokenUsage();
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

    try {
      const autoApproveManager = this.agentManager.getServiceProvider().getService('autoApproveManager') as {
        getSettings?: () => any;
      } | undefined;
      if (autoApproveManager?.getSettings) {
        this.sendMessageToWebview({
          type: 'autoApproveSettingsUpdate',
          settings: autoApproveManager.getSettings()
        });
      }
    } catch (error) {
      console.error('[ChatViewProvider] Error sending auto-approve settings on init:', error);
    }
    
    await this.sendApiKeyStatus();
    
    // Fetch models and send to webview if API key is present
    const hasKey = await this.apiKeyManager.hasKey();
    if (hasKey) {
      try {
        const models = await this.openRouterService.listModels();
        if (models && models.length > 0) {
          this.messageHandler.setAvailableModels(models);
          this.sendMessageToWebview({ type: 'modelsList', models });
        }
      } catch (error) {
        console.error('[ChatViewProvider] Error fetching models on init:', error);
      }
    }

    await this.sendContextUpdate();
    const mode = this.modeService.getCurrentMode();
    if (mode) {
      const isAgentMode = ChatViewProvider.AGENT_LIKE_MODES.includes(mode.id);
      this.sendMessageToWebview({
        type: 'modeChanged',
        modeId: mode.id,
        modeName: mode.displayName,
        modeDescription: mode.description,
        agentMode: isAgentMode
      });
    }
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
    const enrichedMessage = this.enrichOutboundMessage(message);
    this.diagnosticService?.captureOutboundMessage(enrichedMessage);
    if (this._view) this._view.webview.postMessage(enrichedMessage);
  }

  private enrichOutboundMessage(message: any): any {
    if (!message || typeof message !== 'object') return message;
    const mode = this.modeService.getCurrentMode()?.id || this.messageHandler?.getContext?.()?.selectedMode || 'unknown';
    const model = this.messageHandler?.getContext?.()?.selectedModel || 'unknown';
    return {
      ...message,
      mode: typeof message.mode === 'string' && message.mode.trim().length > 0 ? message.mode : mode,
      model: typeof message.model === 'string' && message.model.trim().length > 0 ? message.model : model
    };
  }

  private async syncPlanMetadataFromEvent(event: any): Promise<void> {
    if (!event || typeof event.type !== 'string') return;
    const trackedEvents = new Set([
      'planCardCreated',
      'planCardUpdated',
      'planStatusUpdate',
      'planApprovalRequested',
      'planApprovalResolved'
    ]);
    if (!trackedEvents.has(event.type)) return;

    try {
      const currentPlan = this.agentManager.getPlanningManager()?.getCurrentPlan?.() || null;
      const currentPlanId = currentPlan?.id || null;
      const pendingPlanApproval = currentPlan?.pendingApproval || null;
      await this.sessionHandler.updateSessionMetadata({
        activePlanId: currentPlanId,
        lastPlanUpdate: new Date().toISOString(),
        tasks: {
          currentPlan,
          currentPlanId,
          plans: currentPlan ? [currentPlan] : [],
          pendingPlanApproval
        }
      });
    } catch (error) {
      console.warn('[ChatViewProvider] Failed to persist plan metadata:', error);
    }
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
    this.messageHandler.setSelectedMode(enabled ? 'code' : 'architect');
    this.context?.globalState.update('gently.agentMode', enabled);
    const config = vscode.workspace.getConfiguration('gently');
    if (config.get<boolean>('agentMode', false) !== enabled) {
      void config.update('agentMode', enabled, vscode.ConfigurationTarget.Global);
    }
  }

  public setSelectedModel(model: string): void {
    void this.messageHandler.setSelectedModel(model);
    this.context?.globalState.update('gently.selectedModel', model);
    const config = vscode.workspace.getConfiguration('gently');
    if (config.get<string>('selectedModel', '') !== model) {
      void config.update('selectedModel', model, vscode.ConfigurationTarget.Global);
    }
  }

  /** Modes that behave like an agent (have tools, can execute) */
  private static readonly AGENT_LIKE_MODES = ['code'];

  public async setSelectedMode(modeId: string): Promise<void> {
    const requestedMode = normalizeModeAlias(modeId) || modeId;
    const config = vscode.workspace.getConfiguration('gently');
    const modeStateMachineV2Enabled =
      config.get<boolean>('modeStateMachineV2', true);
    const previousMode = normalizeModeAlias(this.modeService.getCurrentMode()?.id || this.messageHandler.getContext()?.selectedMode) || 'architect';
    if (modeStateMachineV2Enabled && previousMode === 'architect' && requestedMode === 'code' && !this.hasPersistedPlanForCodeTransition()) {
      const message = 'MODE_TRANSITION_BLOCKED: PLAN -> ACT requires an existing persisted plan (create_plan).';
      const correlationId = `mode_transition_blocked:${Date.now()}`;
      console.warn(`[ChatViewProvider] MODE_TRANSITION_BLOCKED previous=${previousMode} requested=${requestedMode} correlationId=${correlationId}`);
      this.messageHandler.setSelectedMode('architect');
      this.context?.globalState.update('gently.selectedMode', 'architect');
      this.context?.globalState.update('gently.agentMode', false);
      if (config.get<boolean>('agentMode', false) !== false) {
        await config.update('agentMode', false, vscode.ConfigurationTarget.Global);
      }

      if (this.modeService.getCurrentMode()?.id !== 'architect') {
        try {
          await this.modeService.setMode('architect');
        } catch (error) {
          console.warn('[ChatViewProvider] Failed to restore architect mode after transition block:', error);
        }
      }

      const mode = this.modeService.getCurrentMode();
      this._view?.webview.postMessage({
        type: 'modeChanged',
        modeId: mode?.id || 'architect',
        modeName: mode?.displayName || 'Architect',
        modeDescription: mode?.description || 'Planning mode',
        agentMode: false
      });
      this._view?.webview.postMessage({
        type: 'resilienceStatus',
        code: 'MODE_TRANSITION_BLOCKED',
        category: 'mode',
        severity: 'warning',
        retryable: false,
        attempt: 1,
        maxAttempts: 1,
        model: this.messageHandler.getContext()?.selectedModel || 'unknown',
        flowId: this.messageHandler.getContext()?.currentFlowId || null,
        userMessage: 'Code mode was blocked because no persisted plan exists. Create a plan first.',
        action: 'create_plan_now',
        phase: 'preflight',
        decision: 'abort',
        reason: 'plan_required_for_plan_to_act_transition',
        correlationId
      });
      this._view?.webview.postMessage({ type: 'error', message, code: 'MODE_TRANSITION_BLOCKED', action: 'create_plan_now' });
      return;
    }

    this.messageHandler.setSelectedMode(requestedMode);
    if (!this.modeService) return;
    try {
      await this.modeService.setMode(requestedMode);
      const mode = this.modeService.getCurrentMode();
      if (mode) {
        // NEVER overwrite the real mode.id — pass it through directly!
        const isAgentMode = ChatViewProvider.AGENT_LIKE_MODES.includes(mode.id);
        this.messageHandler.setSelectedMode(mode.id);
        this.context?.globalState.update('gently.agentMode', isAgentMode);
        if (config.get<boolean>('agentMode', false) !== isAgentMode) {
          void config.update('agentMode', isAgentMode, vscode.ConfigurationTarget.Global);
        }
        console.log(`[ChatViewProvider] setSelectedMode: ${modeId} -> requested ${requestedMode} -> resolved to ${mode.id} (agentLike=${isAgentMode})`);
        this._view?.webview.postMessage({
          type: 'modeChanged', modeId: mode.id, modeName: mode.displayName,
          modeDescription: mode.description, agentMode: isAgentMode,
        });
        await this.applyModeDefaultModel(mode.id);
      }
    } catch (error: any) {
      this._view?.webview.postMessage({ type: 'error', message: `Error switching mode: ${error.message}` });
    }
  }

  private hasPersistedPlanForCodeTransition(): boolean {
    try {
      const plan = this.agentManager.getPlanningManager()?.getCurrentPlan();
      return Boolean(plan && Array.isArray(plan.steps) && plan.steps.length > 0);
    } catch {
      return false;
    }
  }

  private async applyModeDefaultModel(modeId: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('gently');
    const planDefault = String(config.get<string>('modeRouting.planModelDefault', '') || '').trim();
    const codeDefault = String(config.get<string>('modeRouting.codeModelDefault', '') || '').trim();
    const targetModel = modeId === 'architect' ? planDefault : modeId === 'code' ? codeDefault : '';
    if (!targetModel) return;
    if (!this.isStructurallyValidModelId(targetModel)) return;
    const currentModel = this.messageHandler.getContext()?.selectedModel;
    if (currentModel === targetModel) return;
    await this.messageHandler.setSelectedModel(targetModel);
    this.sendMessageToWebview({ type: 'modelChanged', model: targetModel });
    this.sendMessageToWebview({ type: 'info', message: `Mode model default applied: ${targetModel}` });
  }

  private isStructurallyValidModelId(modelId: string): boolean {
    return /^[a-z0-9._-]+\/[a-z0-9._:@+-]+$/i.test(modelId);
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

  public async handleRevertCheckpoint(checkpointId: string, messageId: string, mode: 'files' | 'task' | 'files&task' = 'files'): Promise<void> {
    try {
      const checkpoint = await this.agentManager.getCheckpointManager().getCheckpointForMessage(messageId);
      const checkpointNumber = checkpoint?.checkpointNumber || 0;
      const result = await this.agentManager.restoreCheckpoint(checkpointId, {
        mode,
        messageHistory: this.getContext().conversationHistory,
        pruneHistory: async (startIndex: number) => {
          const history = this.getContext().conversationHistory;
          const pruned = Math.max(0, history.length - startIndex);
          this.getContext().conversationHistory = history.slice(0, startIndex);
          return pruned;
        }
      });

      if (result.success) {
        const filesCount = result.filesRestored.length;
        const modeLabel = mode === 'files&task' ? 'files+task' : mode;
        const msg = `Checkpoint ${checkpointNumber} restored (${modeLabel}) • ${filesCount} ${filesCount === 1 ? 'file' : 'files'}`;
        vscode.window.showInformationMessage(`✅ ${msg}`);
        this._view?.webview.postMessage({ type: 'systemMessage', content: msg });
        this._view?.webview.postMessage({
          type: 'checkpointRestored',
          checkpointId,
          messageId,
          checkpointNumber,
          filesRestored: result.filesRestored,
          mode,
          messagesPruned: result.messagesPruned
        });
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
    void this.messageHandler.sendMessage(prompt, false);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return generateHtml(webview, this._extensionUri);
  }

  public dispose(): void {
    this.terminalManager?.dispose();
  }
}
