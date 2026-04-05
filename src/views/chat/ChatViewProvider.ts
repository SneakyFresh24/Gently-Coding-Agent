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
import { LogService } from '../../services/LogService';

import { ChatViewContext, WebviewMessage } from './types/ChatTypes';

const log = new LogService('ChatViewProvider');

type ExecutionState =
  | 'idle'
  | 'awaiting_plan_approval'
  | 'resuming_after_approval'
  | 'processing'
  | 'tooling'
  | 'failed'
  | 'stopped';

interface PendingPlanResumeIntent {
  key: string;
  planId: string;
  approvalRequestId: string;
  enqueuedAt: number;
  attempts: number;
  nextRetryAt: number;
  lastError?: string;
}

interface ActivePlanResumeRun {
  key: string;
  planId: string;
  approvalRequestId: string;
  attempts: number;
  startedAt: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gently.chatView';
  private _view?: vscode.WebviewView;
  private isWebviewReady = false;
  private isDisposed = false;
  private readyFallbackTimeout?: ReturnType<typeof setTimeout>;
  private readonly localDisposables: vscode.Disposable[] = [];
  
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
  private readonly planResumeQueue: PendingPlanResumeIntent[] = [];
  private readonly processedPlanResumeKeys = new Set<string>();
  private readonly activePlanResumeRunsByFlow = new Map<string, ActivePlanResumeRun>();
  private isDrainingPlanResumeQueue = false;
  private processingActive = false;
  private generatingActive = false;
  private lastExecutionState: ExecutionState = 'idle';
  private readonly planResumeRetryDelayMs = 2_000;
  private readonly planResumeMaxAttempts = 3;

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
      },
      async (session) => {
        const sessionId = session?.id || null;
        this.messageHandler.getContext().activeSessionId = sessionId;
        if (sessionId) {
          this.agentManager.getCheckpointManager().setCurrentSession(sessionId);
        }

        const planningManager = this.agentManager.getPlanningManager?.();
        const tasks = (session?.metadata?.tasks && typeof session.metadata.tasks === 'object')
          ? session.metadata.tasks
          : null;
        const taskPlan = tasks && typeof tasks.currentPlan === 'object'
          ? tasks.currentPlan as any
          : null;
        const taskPlanId = tasks && typeof tasks.currentPlanId === 'string'
          ? tasks.currentPlanId
          : typeof session?.metadata?.activePlanId === 'string'
            ? session.metadata.activePlanId
            : null;

        if (taskPlan && planningManager?.hydratePlan) {
          planningManager.hydratePlan(taskPlan);
        }
        planningManager?.setCurrentPlanId?.(taskPlanId || '');
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


      const messageDisposable = webviewView.webview.onDidReceiveMessage(async (data: unknown) => {
        if (this.isDisposed) return;
        try {
          if (!this.isInboundMessage(data)) {
            this.reportMalformedInboundMessage('unknown', 'non_object_or_missing_type', data);
            return;
          }
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
            const payload = this.parseCommandApprovalResponse(data);
            if (!payload) {
              this.reportMalformedInboundMessage(data.type, 'invalid_command_approval_payload', data);
              return;
            }
            await this.handleCommandApprovalResponse(payload.commandId, payload.response);
            return;
          }
          if (data.type === 'toolApprovalResponse') {
            const payload = this.parseToolApprovalResponse(data);
            if (!payload) {
              this.reportMalformedInboundMessage(data.type, 'invalid_tool_approval_payload', data);
              return;
            }
            await this.agentManager.getToolManager().handleApprovalResponse(payload.approvalId, payload.approved, payload.alwaysApprove);
            return;
          }
          if (data.type === 'questionResponse') {
            const payload = this.parseQuestionResponse(data);
            if (!payload) {
              this.reportMalformedInboundMessage(data.type, 'invalid_question_response_payload', data);
              return;
            }
            try {
              await this.agentManager.getToolManager().handleQuestionResponse(
                payload.questionId,
                payload.selectedOptionIndexes,
                payload.source
              );
            } catch (error: any) {
              const correlationId = `question:${payload.questionId || 'unknown'}:QUESTION_RESPONSE_DISPATCH_FAILED:${Date.now()}`;
              const context = this.messageHandler?.getContext?.();
              const mode = typeof context?.selectedMode === 'string' ? context.selectedMode : 'unknown';
              const model = typeof context?.selectedModel === 'string' ? context.selectedModel : 'unknown';
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error('[ChatViewProvider] Failed to dispatch question response:', {
                questionId: payload.questionId || null,
                selectedCount: payload.selectedOptionIndexes.length,
                source: payload.source,
                correlationId,
                error: errorMessage
              });
              this.sendMessageToWebview({
                type: 'resilienceStatus',
                code: 'QUESTION_RESPONSE_DISPATCH_FAILED',
                category: 'tool',
                severity: 'error',
                retryable: false,
                attempt: 1,
                maxAttempts: 1,
                model,
                flowId: context?.currentFlowId || null,
                userMessage: 'Question response could not be dispatched. Please retry.',
                action: 'none',
                phase: 'runtime',
                decision: 'abort',
                reason: 'dispatch_exception',
                correlationId
              } as any);
              this.sendMessageToWebview({
                type: 'systemMessage',
                messageId: `sys_question_dispatch_${Date.now()}`,
                content: `Question response dispatch failed (questionId=${payload.questionId || 'unknown'}, source=${payload.source}, selected=${payload.selectedOptionIndexes.length}).`,
                code: 'QUESTION_RESPONSE_DISPATCH_FAILED',
                severity: 'error',
                correlationId,
                mode,
                model
              } as any);
            }
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
      this.localDisposables.push(messageDisposable);

      // Safety Fallback: Initialize after 5 seconds if 'ready' msg was missed
      if (this.readyFallbackTimeout) {
        clearTimeout(this.readyFallbackTimeout);
      }
      this.readyFallbackTimeout = setTimeout(() => {
        if (this.isDisposed) return;
        if (this._view && !this.isWebviewReady) {
          console.warn('[ChatViewProvider] Webview ready timeout → initializing data anyway');
          void this.initializeWebviewData();
        }
      }, 5000);
    } catch (error: any) {
      console.error('[ChatViewProvider] Error resolving webview view:', error);
      vscode.window.showErrorMessage(`Failed to initialize chat view: ${error.message}`);
    }
  }

  private async initializeWebviewData(): Promise<void> {
    if (this.isDisposed) return;
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
    if (this.isDisposed) return;
    this.observeExecutionLifecycle(message);
    this.postMessageToWebview(message);
  }

  private postMessageToWebview(message: any): void {
    if (this.isDisposed) return;
    const enrichedMessage = this.enrichOutboundMessage(message);
    this.diagnosticService?.captureOutboundMessage(enrichedMessage);
    if (this._view) this._view.webview.postMessage(enrichedMessage);
  }

  private observeExecutionLifecycle(message: any): void {
    if (!message || typeof message.type !== 'string') return;

    const type = String(message.type);
    if (type === 'processingStart') {
      this.processingActive = true;
      this.emitExecutionStateUpdate('processing', {
        reasonCode: 'processing_start',
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return;
    }

    if (type === 'generatingStart') {
      this.generatingActive = true;
      this.emitExecutionStateUpdate('processing', {
        reasonCode: 'generating_start',
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return;
    }

    if (type === 'toolExecutionStart') {
      this.emitExecutionStateUpdate('tooling', {
        reasonCode: 'tool_execution_start',
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return;
    }

    if (type === 'planApprovalRequested') {
      const planId = typeof message.planId === 'string' ? message.planId : '';
      this.emitExecutionStateUpdate('awaiting_plan_approval', {
        reasonCode: 'plan_approval_requested',
        planId: planId || undefined,
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return;
    }

    if (type === 'planApprovalResolved') {
      const status = String(message.status || '');
      const resolution = String(message.resolution || 'applied');
      const planId = typeof message.planId === 'string' ? message.planId : '';
      const approvalRequestId = typeof message.approvalRequestId === 'string' ? message.approvalRequestId : '';

      if (resolution === 'applied' && status === 'approved' && planId) {
        this.emitExecutionStateUpdate('resuming_after_approval', {
          reasonCode: 'plan_approval_applied',
          planId,
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        this.enqueuePlanResumeIntent(planId, approvalRequestId);
        return;
      }

      if (resolution === 'applied' && status === 'rejected') {
        this.emitExecutionStateUpdate('failed', {
          reasonCode: 'plan_rejected',
          planId: planId || undefined,
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        return;
      }
    }

    if (type === 'resilienceStatus') {
      const code = String(message.code || '');
      if (code === 'REQUEST_STOPPED') {
        this.emitExecutionStateUpdate('stopped', {
          reasonCode: code,
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        return;
      }

      if (
        code === 'MODE_TOOL_BLOCKED' ||
        code === 'CODE_ENTRY_BLOCKED' ||
        code === 'TOOL_DISPATCH_TERMINAL_ERROR'
      ) {
        this.emitExecutionStateUpdate('failed', {
          reasonCode: code,
          detail: typeof message.reason === 'string' ? message.reason : undefined,
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        return;
      }
    }

    if (type === 'stopAcknowledged') {
      this.processingActive = false;
      this.generatingActive = false;
      this.resetPlanResumeState();
      this.emitExecutionStateUpdate('stopped', {
        reasonCode: typeof message.reasonCode === 'string' ? message.reasonCode : 'REQUEST_STOPPED',
        flowId: typeof message.flowId === 'string' ? message.flowId : this.messageHandler.getContext()?.currentFlowId || null
      });
      return;
    }

    if (type === 'queryRuntimeEvent') {
      const runtimeEvent = message.event && typeof message.event === 'object' ? message.event : null;
      const runtimeType = String(runtimeEvent?.type || '');
      const flowId = typeof runtimeEvent?.flowId === 'string' ? runtimeEvent.flowId : this.messageHandler.getContext()?.currentFlowId || null;
      if (runtimeType === 'result_success') {
        if (flowId) {
          this.handlePlanResumeRuntimeSuccess(flowId);
        }
        this.processingActive = false;
        this.generatingActive = false;
        this.emitExecutionStateUpdate('idle', { reasonCode: 'result_success', flowId });
        void this.drainPlanResumeQueue();
        return;
      }
      if (runtimeType === 'result_error') {
        if (flowId) {
          this.handlePlanResumeRuntimeError(flowId, runtimeEvent);
        }
        this.processingActive = false;
        this.generatingActive = false;
        const code = String((runtimeEvent as any)?.result?.code || 'result_error');
        this.emitExecutionStateUpdate(code === 'REQUEST_STOPPED' ? 'stopped' : 'failed', {
          reasonCode: code,
          flowId
        });
        void this.drainPlanResumeQueue();
        return;
      }
      if (runtimeType === 'turn_transition' && String((runtimeEvent as any)?.to || '') === 'TERMINAL') {
        this.processingActive = false;
        this.generatingActive = false;
        void this.drainPlanResumeQueue();
      }
      return;
    }

    if (type === 'processingEnd') {
      this.processingActive = false;
      if (!this.isExecutionBusy()) {
        this.emitExecutionStateUpdate('idle', {
          reasonCode: 'processing_end_idle',
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        void this.drainPlanResumeQueue();
      }
      return;
    }

    if (type === 'generatingEnd') {
      this.generatingActive = false;
      if (!this.isExecutionBusy()) {
        this.emitExecutionStateUpdate('idle', {
          reasonCode: 'generating_end_idle',
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });
        void this.drainPlanResumeQueue();
      }
      return;
    }
  }

  private emitExecutionStateUpdate(
    state: ExecutionState,
    detail: {
      reasonCode?: string;
      flowId?: string | null;
      planId?: string;
      detail?: string;
    } = {}
  ): void {
    if (this.isDisposed) return;
    const payload = {
      type: 'executionStateUpdate',
      state,
      reasonCode: detail.reasonCode,
      flowId: detail.flowId ?? this.messageHandler.getContext()?.currentFlowId ?? null,
      planId: detail.planId,
      detail: detail.detail,
      timestamp: Date.now()
    };

    const shouldSuppressDuplicate =
      this.lastExecutionState === state &&
      (!detail.reasonCode || detail.reasonCode === 'processing_start' || detail.reasonCode === 'generating_start');
    if (shouldSuppressDuplicate) return;
    this.lastExecutionState = state;
    this.postMessageToWebview(payload);
  }

  private isExecutionBusy(): boolean {
    if (this.processingActive || this.generatingActive) return true;
    const context = this.messageHandler?.getContext?.();
    return Boolean(context?.isToolExecutionActive);
  }

  private enqueuePlanResumeIntent(planId: string, approvalRequestId?: string): void {
    const normalizedPlanId = String(planId || '').trim();
    if (!normalizedPlanId) return;
    const normalizedApprovalId = String(approvalRequestId || '').trim();
    const key = this.getPlanResumeKey(normalizedPlanId, normalizedApprovalId);
    if (this.processedPlanResumeKeys.has(key)) return;
    if (Array.from(this.activePlanResumeRunsByFlow.values()).some((entry) => entry.key === key)) return;
    if (this.planResumeQueue.some((entry) => entry.key === key)) return;

    this.planResumeQueue.push({
      key,
      planId: normalizedPlanId,
      approvalRequestId: normalizedApprovalId,
      enqueuedAt: Date.now(),
      attempts: 0,
      nextRetryAt: Date.now()
    });

    void this.drainPlanResumeQueue();
  }

  private getPlanResumeKey(planId: string, approvalRequestId: string): string {
    return `${planId}:${approvalRequestId || 'no_approval_request'}`;
  }

  private resetPlanResumeState(): void {
    this.planResumeQueue.length = 0;
    this.processedPlanResumeKeys.clear();
    this.activePlanResumeRunsByFlow.clear();
    this.isDrainingPlanResumeQueue = false;
  }

  private async drainPlanResumeQueue(): Promise<void> {
    if (this.isDisposed || this.isDrainingPlanResumeQueue) return;
    this.isDrainingPlanResumeQueue = true;
    try {
      while (this.planResumeQueue.length > 0) {
        if (this.isExecutionBusy()) break;
        const current = this.planResumeQueue[0];
        if (!current) break;
        if (Date.now() < current.nextRetryAt) break;

        this.emitExecutionStateUpdate('resuming_after_approval', {
          reasonCode: 'plan_resume_starting',
          planId: current.planId,
          flowId: this.messageHandler.getContext()?.currentFlowId || null
        });

        const started = await this.tryStartPlanResume(current);
        if (started) {
          this.planResumeQueue.shift();
          continue;
        }

        current.attempts += 1;
        const nextAttempt = current.attempts + 1;
        if (current.attempts >= this.planResumeMaxAttempts) {
          this.planResumeQueue.shift();
          this.processedPlanResumeKeys.add(current.key);
          this.emitExecutionStateUpdate('failed', {
            reasonCode: 'PLAN_RESUME_RETRY_EXHAUSTED',
            detail: current.lastError || 'Plan resume failed after maximum retries.',
            planId: current.planId,
            flowId: this.messageHandler.getContext()?.currentFlowId || null
          });
          log.event('ERROR', 'PLAN_RESUME_RETRY_EXHAUSTED', 'PLAN_RESUME_RETRY_EXHAUSTED', {
            planId: current.planId,
            attempts: current.attempts,
            maxAttempts: this.planResumeMaxAttempts,
            reason: current.lastError || 'unknown'
          });
          continue;
        }
        current.nextRetryAt = Date.now() + this.computePlanResumeRetryDelayMs(current.attempts);
        log.event('WARN', 'PLAN_RESUME_RETRY_SCHEDULED', 'PLAN_RESUME_RETRY_SCHEDULED', {
          planId: current.planId,
          attempts: current.attempts,
          nextAttempt,
          nextRetryAt: current.nextRetryAt,
          reason: current.lastError || 'start_failed'
        });
        break;
      }
    } catch (error) {
      log.error('[ChatViewProvider] Plan resume queue drain failed:', error);
      const current = this.planResumeQueue[0];
      if (current) {
        current.attempts += 1;
        const nextAttempt = current.attempts + 1;
        if (current.attempts >= this.planResumeMaxAttempts) {
          this.planResumeQueue.shift();
          this.processedPlanResumeKeys.add(current.key);
          this.emitExecutionStateUpdate('failed', {
            reasonCode: 'PLAN_RESUME_RETRY_EXHAUSTED',
            detail: error instanceof Error ? error.message : String(error),
            planId: current.planId,
            flowId: this.messageHandler.getContext()?.currentFlowId || null
          });
          log.event('ERROR', 'PLAN_RESUME_RETRY_EXHAUSTED', 'PLAN_RESUME_RETRY_EXHAUSTED', {
            planId: current.planId,
            attempts: current.attempts,
            maxAttempts: this.planResumeMaxAttempts,
            reason: error instanceof Error ? error.message : String(error)
          });
        } else {
          current.lastError = error instanceof Error ? error.message : String(error);
          current.nextRetryAt = Date.now() + this.computePlanResumeRetryDelayMs(current.attempts);
          log.event('WARN', 'PLAN_RESUME_RETRY_SCHEDULED', 'PLAN_RESUME_RETRY_SCHEDULED', {
            planId: current.planId,
            attempts: current.attempts,
            nextAttempt,
            nextRetryAt: current.nextRetryAt,
            reason: current.lastError
          });
        }
      }
    } finally {
      this.isDrainingPlanResumeQueue = false;
    }
  }

  private async tryStartPlanResume(intent: PendingPlanResumeIntent): Promise<boolean> {
    const planningManager = this.agentManager.getPlanningManager?.();
    const preparation = await planningManager?.prepareCodeEntry?.(intent.planId);
    if (!preparation?.ok) {
      intent.lastError = preparation?.reason || 'Code entry blocked while resuming approved plan.';
      this.emitExecutionStateUpdate('failed', {
        reasonCode: preparation?.code || 'CODE_ENTRY_BLOCKED',
        detail: intent.lastError,
        planId: intent.planId,
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return false;
    }

    const currentMode = normalizeModeAlias(this.modeService.getCurrentMode()?.id || this.messageHandler.getContext()?.selectedMode) || 'architect';
    if (currentMode !== 'code') {
      await this.setSelectedMode('code');
    }

    const activeMode = normalizeModeAlias(this.modeService.getCurrentMode()?.id || this.messageHandler.getContext()?.selectedMode) || 'architect';
    if (activeMode !== 'code') {
      intent.lastError = 'Mode transition to code failed during plan resume.';
      this.emitExecutionStateUpdate('failed', {
        reasonCode: 'MODE_SWITCH_FAILED',
        detail: intent.lastError,
        planId: intent.planId,
        flowId: this.messageHandler.getContext()?.currentFlowId || null
      });
      return false;
    }

    const context = this.messageHandler.getContext();
    const flowId = `flow-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const attempt = intent.attempts + 1;
    context.currentFlowId = flowId;
    this.activePlanResumeRunsByFlow.set(flowId, {
      key: intent.key,
      planId: intent.planId,
      approvalRequestId: intent.approvalRequestId,
      attempts: attempt,
      startedAt: Date.now()
    });

    try {
      await planningManager?.beginExecution?.(intent.planId);
    } catch (error) {
      console.warn('[ChatViewProvider] Failed to transition plan into execution state during resume:', error);
    }

    if (!context.selectedModel) {
      intent.lastError = 'No model selected for auto-resume execution.';
      this.emitExecutionStateUpdate('failed', {
        reasonCode: 'MODEL_NOT_SELECTED',
        detail: intent.lastError,
        planId: intent.planId,
        flowId: context.currentFlowId || null
      });
      this.activePlanResumeRunsByFlow.delete(flowId);
      return false;
    }

    await this.messageHandler.sendMessage(
      'Implement the approved plan step by step. Start with step 1 and keep the plan step statuses synchronized while you execute.',
      true,
      undefined,
      0,
      'resume'
    );
    return true;
  }

  private computePlanResumeRetryDelayMs(nextAttempt: number): number {
    const boundedAttempt = Math.max(1, Math.min(nextAttempt, this.planResumeMaxAttempts));
    return this.planResumeRetryDelayMs * Math.pow(2, boundedAttempt - 1);
  }

  private handlePlanResumeRuntimeSuccess(flowId: string): void {
    const active = this.activePlanResumeRunsByFlow.get(flowId);
    if (!active) return;
    this.activePlanResumeRunsByFlow.delete(flowId);
    this.processedPlanResumeKeys.add(active.key);
  }

  private handlePlanResumeRuntimeError(flowId: string, runtimeEvent: any): void {
    const active = this.activePlanResumeRunsByFlow.get(flowId);
    if (!active) return;
    this.activePlanResumeRunsByFlow.delete(flowId);
    const resultCode = String(runtimeEvent?.result?.code || '');
    const resultMessage = String(runtimeEvent?.result?.message || '');
    const rateLimited =
      resultCode === 'RATE_LIMIT_RETRY_EXHAUSTED' ||
      resultMessage.toLowerCase().includes('rate-limit') ||
      resultMessage.toLowerCase().includes('rate limit') ||
      resultMessage.toLowerCase().includes('provider is currently rate-limited');
    if (!rateLimited) {
      this.processedPlanResumeKeys.add(active.key);
      return;
    }

    if (active.attempts >= this.planResumeMaxAttempts) {
      this.processedPlanResumeKeys.add(active.key);
      this.emitExecutionStateUpdate('failed', {
        reasonCode: 'PLAN_RESUME_RETRY_EXHAUSTED',
        detail: resultMessage || 'Plan resume failed after maximum retries.',
        planId: active.planId,
        flowId
      });
      log.event('ERROR', 'PLAN_RESUME_RETRY_EXHAUSTED', 'PLAN_RESUME_RETRY_EXHAUSTED', {
        flowId,
        planId: active.planId,
        attempts: active.attempts,
        maxAttempts: this.planResumeMaxAttempts,
        reason: resultCode || resultMessage || 'rate_limit'
      });
      return;
    }

    const retryIntent: PendingPlanResumeIntent = {
      key: active.key,
      planId: active.planId,
      approvalRequestId: active.approvalRequestId,
      enqueuedAt: Date.now(),
      attempts: active.attempts,
      nextRetryAt: Date.now() + this.computePlanResumeRetryDelayMs(active.attempts),
      lastError: resultMessage || resultCode || 'rate_limit'
    };
    if (!this.planResumeQueue.some((entry) => entry.key === retryIntent.key)) {
      this.planResumeQueue.push(retryIntent);
    }

    this.emitExecutionStateUpdate('resuming_after_approval', {
      reasonCode: 'PLAN_RESUME_RETRY_SCHEDULED',
      planId: active.planId,
      flowId
    });
    log.event('WARN', 'PLAN_RESUME_RETRY_SCHEDULED', 'PLAN_RESUME_RETRY_SCHEDULED', {
      flowId,
      planId: active.planId,
      attempts: active.attempts,
      nextAttempt: active.attempts + 1,
      nextRetryAt: retryIntent.nextRetryAt,
      reason: resultCode || resultMessage || 'rate_limit'
    });
    void this.drainPlanResumeQueue();
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

  private isInboundMessage(value: unknown): value is WebviewMessage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const maybeMessage = value as { type?: unknown };
    return typeof maybeMessage.type === 'string' && maybeMessage.type.trim().length > 0;
  }

  private parseCommandApprovalResponse(
    data: { commandId?: unknown; response?: unknown }
  ): { commandId: string; response: 'accept' | 'accept_always' | 'deny' } | null {
    const commandId = typeof data.commandId === 'string' ? data.commandId.trim() : '';
    if (!commandId) return null;
    const response = typeof data.response === 'string' ? data.response.trim().toLowerCase() : '';
    if (response === 'accept' || response === 'accept_always' || response === 'deny') {
      return { commandId, response };
    }
    return null;
  }

  private parseToolApprovalResponse(
    data: { approvalId?: unknown; approved?: unknown; alwaysApprove?: unknown }
  ): { approvalId: string; approved: boolean; alwaysApprove: boolean } | null {
    const approvalId = typeof data.approvalId === 'string' ? data.approvalId.trim() : '';
    if (!approvalId) return null;
    if (typeof data.approved !== 'boolean') return null;
    return {
      approvalId,
      approved: data.approved,
      alwaysApprove: data.alwaysApprove === true
    };
  }

  private parseQuestionResponse(
    data: { questionId?: unknown; selectedOptionIndexes?: unknown; source?: unknown }
  ): { questionId: string; selectedOptionIndexes: number[]; source: 'user' | 'stopped' } | null {
    const questionId = typeof data.questionId === 'string' ? data.questionId.trim() : '';
    if (!questionId) return null;
    if (!Array.isArray(data.selectedOptionIndexes)) return null;
    const selectedOptionIndexes = data.selectedOptionIndexes
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isInteger(value) && value >= 0);
    return {
      questionId,
      selectedOptionIndexes,
      source: data.source === 'stopped' ? 'stopped' : 'user'
    };
  }

  private reportMalformedInboundMessage(type: string, reason: string, payload: unknown): void {
    const context = this.messageHandler?.getContext?.();
    const flowId = context?.currentFlowId || null;
    const mode = context?.selectedMode || 'unknown';
    const model = context?.selectedModel || 'unknown';
    const correlationId = `malformed:webview:${type || 'unknown'}:${Date.now()}`;
    this.diagnosticService?.recordUnknownEvent({
      kind: 'webview_message',
      origin: 'chat_view_provider',
      rawType: type || 'unknown',
      correlationId,
      flowId,
      mode,
      model,
      payload: {
        reason,
        payloadType: payload === null ? 'null' : typeof payload
      }
    });
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
    if (modeStateMachineV2Enabled && requestedMode === 'code') {
      const preparation = await this.agentManager.getPlanningManager()?.prepareCodeEntry?.();
      if (!preparation?.ok) {
        const correlationId = `mode_transition_blocked:${Date.now()}`;
        const action = preparation?.code === 'PLAN_APPROVAL_PENDING_EXPLICIT' ? 'none' : 'create_plan_now';
        const reason = preparation?.code || 'plan_required_for_plan_to_act_transition';
        const message =
          `MODE_TRANSITION_BLOCKED: PLAN -> ACT blocked (${reason}). ` +
          `${preparation?.reason || 'Create and approve a plan first.'}`;
        console.warn(`[ChatViewProvider] MODE_TRANSITION_BLOCKED previous=${previousMode} requested=${requestedMode} reason=${reason} correlationId=${correlationId}`);

        if (previousMode === 'architect') {
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
        }

        this._view?.webview.postMessage({
          type: 'resilienceStatus',
          code: 'CODE_ENTRY_BLOCKED',
          category: 'mode',
          severity: 'warning',
          retryable: false,
          attempt: 1,
          maxAttempts: 1,
          model: this.messageHandler.getContext()?.selectedModel || 'unknown',
          flowId: this.messageHandler.getContext()?.currentFlowId || null,
          userMessage: preparation?.reason || 'Code mode is blocked by the current plan state.',
          action,
          phase: 'preflight',
          decision: 'abort',
          reason,
          correlationId
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
          userMessage: preparation?.reason || 'Code mode transition is blocked.',
          action,
          phase: 'preflight',
          decision: 'abort',
          reason,
          correlationId
        });
        this._view?.webview.postMessage({ type: 'error', message, code: 'MODE_TRANSITION_BLOCKED', action });
        return;
      }

      if (preparation.autoHandedOver) {
        const correlationId = `code_entry_auto_handover:${Date.now()}`;
        this._view?.webview.postMessage({
          type: 'resilienceStatus',
          code: 'CODE_ENTRY_AUTO_HANDOVER_APPLIED',
          category: 'mode',
          severity: 'info',
          retryable: false,
          attempt: 1,
          maxAttempts: 1,
          model: this.messageHandler.getContext()?.selectedModel || 'unknown',
          flowId: this.messageHandler.getContext()?.currentFlowId || null,
          userMessage: preparation.reason,
          action: 'none',
          phase: 'preflight',
          decision: 'recover',
          reason: preparation.code,
          correlationId
        });
      }
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
    return /^[^/\s]+\/[^\s]+$/.test(modelId);
  }

  private async stopActiveExecution(reasonCode: string): Promise<void> {
    await this.messageHandler.stopMessage(reasonCode);
    this.processingActive = false;
    this.generatingActive = false;
    this.resetPlanResumeState();
    this.emitExecutionStateUpdate('stopped', {
      reasonCode,
      flowId: this.messageHandler.getContext()?.currentFlowId || null
    });
  }

  public stopMessage(): void {
    void this.stopActiveExecution('REQUEST_STOPPED');
  }

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
  public async handleNewSession(): Promise<void> {
    await this.stopActiveExecution('SESSION_SWAP_STOP');
    await this.sessionHandler.handleNewSession();
  }
  public async handleSwitchSession(sessionId: string): Promise<void> {
    await this.stopActiveExecution('SESSION_SWAP_STOP');
    await this.sessionHandler.handleSwitchSession(sessionId);
  }
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
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.readyFallbackTimeout) {
      clearTimeout(this.readyFallbackTimeout);
      this.readyFallbackTimeout = undefined;
    }

    for (const disposable of this.localDisposables.splice(0)) {
      try {
        disposable.dispose();
      } catch (error) {
        console.warn('[ChatViewProvider] Failed to dispose local disposable', error);
      }
    }

    this.pendingMessages = [];
    this.resetPlanResumeState();
    this.processingActive = false;
    this.generatingActive = false;
    this.lastExecutionState = 'idle';
    this._view = undefined;
    this.isWebviewReady = false;

    try {
      this.diagnosticService?.setSystemWarningEmitter(() => {});
    } catch (error) {
      console.warn('[ChatViewProvider] Failed to detach diagnostic warning emitter', error);
    }

    try {
      this.agentManager.setEventCallback(() => {});
      this.agentManager.setValidationMessageCallback(() => {});
    } catch (error) {
      console.warn('[ChatViewProvider] Failed to detach agent callbacks', error);
    }

    try {
      this.terminalManager?.dispose();
    } catch (error) {
      console.warn('[ChatViewProvider] Failed to dispose terminal manager', error);
    } finally {
      this.terminalManager = undefined;
    }
  }
}
