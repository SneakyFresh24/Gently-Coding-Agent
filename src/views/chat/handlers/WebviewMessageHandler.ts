// =====================================================
// Webview Message Handler – BYOK Edition (no auth)
// =====================================================

import * as vscode from 'vscode';
import { MessageHandler } from './MessageHandler';
import { SessionHandler } from './SessionHandler';
import { FileHandler } from './FileHandler';
import { SystemHandler } from './SystemHandler';
import { WebviewMessage } from '../types/ChatTypes';
import { SessionType } from '../../../services/HistoryManager';
import { MessageValidator } from '../validation';
import { ApiKeyManager } from '../../../services/ApiKeyManager';
import { OpenRouterService } from '../../../services/OpenRouterService';
import { DiagnosticService } from '../../../services/DiagnosticService';

import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';

export class WebviewMessageHandler {
  private readonly messageValidator: MessageValidator;
  private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void;

  constructor(
    private readonly messageHandler: MessageHandler,
    private readonly sessionHandler: SessionHandler,
    private readonly fileHandler: FileHandler,
    private readonly systemHandler: SystemHandler,
    private readonly apiKeyManager: ApiKeyManager,
    private readonly openRouterService: OpenRouterService,
    sendMessageToWebview: (message: OutboundWebviewMessage) => void
  ) {
    this.sendMessageToWebview = sendMessageToWebview;
    this.messageValidator = new MessageValidator({
      enableRateLimit: true,
      maxMessageSize: 1024 * 1024,
      rateLimitWindow: 60000,
      maxMessagesPerWindow: 100,
      enableSanitization: true,
      enableSecurityLogging: true
    });
  }

  async handleMessage(data: WebviewMessage, webview: vscode.WebviewView): Promise<void> {
    try {
      const validation = this.messageValidator.validateInboundMessage(data);
      if (!validation.isValid) {
        this.messageValidator.showValidationErrors(validation.errors);
        console.error('[WebviewMessageHandler] Validation failed:', validation.errors);
        return;
      }
      if (validation.warnings.length > 0) {
        this.messageValidator.showValidationWarnings(validation.warnings);
      }
      const messageData = validation.sanitizedData || data;
      await this.processValidatedMessage(messageData, webview);
    } catch (error) {
      console.error('[WebviewMessageHandler] Error handling message:', error);
      webview.webview.postMessage({
        type: 'error',
        message: 'An error occurred while processing your message. Please try again.'
      });
    }
  }

  private async processValidatedMessage(data: WebviewMessage, webview: vscode.WebviewView): Promise<void> {
    switch (data.type) {
      case 'ready':
        // Handled directly in ChatViewProvider for initialization sequencing
        break;

      case 'sendMessage':
        if (await this.tryResolvePlanApprovalFromChatText(data.message)) {
          break;
        }
        await this.messageHandler.sendMessage(data.message, false, data.fileReferences);
        break;

      case 'clearHistory':
        this.messageHandler.clearHistory();
        break;

      case 'setApiKey': {
        const key = data.key?.trim();
        if (!key) {
          this.sendMessageToWebview({ type: 'apiKeyStatus', hasKey: false, error: 'API key cannot be empty' });
          break;
        }
        await this.apiKeyManager.setKey(key);
        this.sendMessageToWebview({ type: 'apiKeyStatus', hasKey: true });
        vscode.window.showInformationMessage('✅ OpenRouter API key saved!');

        // Fetch models immediately after setting key
        try {
          const models = await this.openRouterService.listModels();
          this.messageHandler.setAvailableModels(models);
          this.sendMessageToWebview({ type: 'modelsList', models });
        } catch (err) {
          console.error('[WebviewMessageHandler] Error fetching models after key set:', err);
        }
        break;
      }

      case 'deleteApiKey':
        await this.apiKeyManager.deleteKey();
        this.sendMessageToWebview({ type: 'apiKeyStatus', hasKey: false });
        break;

      case 'checkApiKey': {
        const hasKey2 = await this.apiKeyManager.hasKey();
        this.sendMessageToWebview({ type: 'apiKeyStatus', hasKey: hasKey2 });
        break;
      }

      case 'fetchModels': {
        try {
          const models = await this.openRouterService.listModels();
          this.messageHandler.setAvailableModels(models);
          this.sendMessageToWebview({ type: 'modelsList', models });
        } catch (error: any) {
          console.error('[WebviewMessageHandler] Error fetching models:', error);
          this.sendMessageToWebview({ type: 'error', message: 'Failed to fetch OpenRouter models: ' + error.message });
        }
        break;
      }

      case 'modelChanged':
        // Accept any OpenRouter model slug
        await this.messageHandler.setSelectedModel(data.model as any);
        console.log(`[WebviewMessageHandler] Model changed: ${data.model}`);
        break;

      case 'setMaxTokens':
        console.log(`[WebviewMessageHandler] Setting max tokens: ${data.maxTokens}`);
        await vscode.workspace.getConfiguration('gently').update('maxTokens', data.maxTokens, vscode.ConfigurationTarget.Global);
        break;

      case 'requestContextUpdate':
        await this.sendContextUpdate(webview);
        break;

      case 'addFilesToContext':
        await this.fileHandler.handleOpenFilePicker();
        break;

      case 'togglePinFile':
        await this.fileHandler.handleTogglePinFile(data.filePath);
        break;

      case 'stopMessage':
        await this.messageHandler.stopMessage('REQUEST_STOPPED');
        break;

      case 'getWorkspaceInfo':
        await this.sendWorkspaceInfo(webview);
        break;

      case 'openMemories':
        vscode.commands.executeCommand('gently.openMemories');
        break;

      case 'openFile':
        await this.fileHandler.handleOpenFile(data.path);
        break;

      case 'searchFiles':
        await this.fileHandler.handleSearchFiles(data.query);
        break;

      case 'openFilePicker':
        await this.fileHandler.handleOpenFilePicker();
        break;

      case 'requestFilePreview':
        await this.fileHandler.handleRequestFilePreview(data.path);
        break;

      case 'revertCheckpoint': {
        console.log(`[WebviewMessageHandler] Reverting checkpoint ${data.checkpointId}`);
        try {
          const agentManager = (this.systemHandler as any).agentManager;
          if (agentManager) {
            this.sendMessageToWebview({
              type: 'checkpointRestorePlanned',
              checkpointId: data.checkpointId,
              messageId: data.messageId,
              mode: data.mode || 'files'
            });
            const mode = data.mode || 'files';
            const context = this.messageHandler.getContext();
            const result = await agentManager.restoreCheckpoint(data.checkpointId, {
              mode,
              messageHistory: context?.conversationHistory,
              pruneHistory: async (startIndex: number) => {
                if (!context || !Array.isArray(context.conversationHistory)) return 0;
                const originalLength = context.conversationHistory.length;
                context.conversationHistory = context.conversationHistory.slice(0, startIndex);
                return Math.max(0, originalLength - context.conversationHistory.length);
              }
            });
            if (result.success) {
              vscode.window.showInformationMessage(`✅ Checkpoint erfolgreich wiederhergestellt: ${result.filesRestored.length} Dateien.`);
              this.sendMessageToWebview({
                type: 'checkpointRestored',
                checkpointId: data.checkpointId,
                messageId: data.messageId,
                checkpointNumber: result.checkpointNumber || 0,
                filesRestored: result.filesRestored,
                mode,
                messagesPruned: result.messagesPruned
              });
            } else {
              vscode.window.showErrorMessage(`❌ Fehler beim Wiederherstellen: ${result.errors?.join(', ')}`);
            }
          }
        } catch (error) {
          console.error('[WebviewMessageHandler] Revert error:', error);
          vscode.window.showErrorMessage('❌ Ein unerwarteter Fehler ist aufgetreten.');
        }
        break;
      }

      case 'getCheckpoints': {
        try {
          const agentManager = (this.systemHandler as any).agentManager;
          if (agentManager && data.messageId) {
            const checkpoints = await agentManager.getCheckpointManager().getCheckpointsForMessage(data.messageId);
            this.sendMessageToWebview({
              type: 'checkpoints',
              messageId: data.messageId,
              checkpoints: checkpoints.map((cp: any) => ({
                id: cp.id,
                checkpointNumber: cp.checkpointNumber,
                description: cp.description,
                timestamp: cp.timestamp,
                commitHash: cp.commitHash,
                filesChanged: cp.metadata?.filesChanged
              }))
            });
          }
        } catch (error) {
          console.error('[WebviewMessageHandler] Error fetching checkpoints:', error);
        }
        break;
      }

      case 'getCheckpointDiff': {
        try {
          const agentManager = (this.systemHandler as any).agentManager;
          if (agentManager && data.fromCheckpointId) {
            const diff = await agentManager.getCheckpointManager().getDiffSet(data.fromCheckpointId, data.toCheckpointId);
            this.sendMessageToWebview({
              type: 'checkpointDiffReady',
              fromCheckpointId: data.fromCheckpointId,
              toCheckpointId: data.toCheckpointId,
              files: diff.files
            });
          }
        } catch (error: any) {
          this.sendMessageToWebview({
            type: 'error',
            message: `Failed to load checkpoint diff: ${error?.message || String(error)}`
          });
        }
        break;
      }

      case 'systemMessageCreated':
        await this.handleSystemMessageCreated(data.messageId, data.content);
        break;

      case 'commandApprovalCreated':
        await this.handleCommandApprovalCreated(data.message);
        break;

      case 'commandApprovalUpdated':
        await this.handleCommandApprovalUpdated(data.message);
        break;

      case 'toolExecutionCreated':
        await this.handleToolExecutionCreated(data.message);
        break;

      case 'toolExecutionUpdated':
        await this.handleToolExecutionUpdated(data.message);
        break;

      case 'getSessions':
        await this.sessionHandler.handleGetSessions();
        break;

      case 'newSession':
        await this.messageHandler.stopMessage('SESSION_SWAP_STOP');
        await this.sessionHandler.handleNewSession();
        break;

      case 'switchSession':
        await this.messageHandler.stopMessage('SESSION_SWAP_STOP');
        await this.sessionHandler.handleSwitchSession(data.sessionId);
        break;

      case 'sessionAction':
        if (data.action === 'delete') {
          const choice = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this chat session? This action cannot be undone.',
            { modal: true },
            'Delete Session'
          );
          if (choice !== 'Delete Session') {
            this.sendMessageToWebview({ type: 'info', message: 'Session deletion canceled.' });
            break;
          }
        }
        await this.sessionHandler.handleSessionAction(data.action, data.sessionId, data.payload);
        break;

      case 'searchSessions':
        await this.sessionHandler.handleSearchSessions(data.query);
        break;

      case 'refreshSessions':
        await this.sessionHandler.refreshSessions();
        await this.sessionHandler.handleGetSessions();
        break;

      case 'commandApprovalResponse':
        // Handled directly in ChatViewProvider for simplicity
        break;

      case 'killCommand':
        console.log(`[WebviewMessageHandler] Kill command: ${data.commandId}`);
        break;

      case 'setTerminalMode':
        console.log(`[WebviewMessageHandler] Terminal mode: ${data.mode}`);
        break;

      case 'toggleQuickPattern':
        console.log(`[WebviewMessageHandler] Quick pattern: ${data.name} = ${data.enabled}`);
        break;

      case 'setAutoApproveSettings': {
        const agentManager = (this.systemHandler as any).agentManager;
        const autoApproveManager = agentManager.getServiceProvider().getService('autoApproveManager');
        if (autoApproveManager) {
          await autoApproveManager.setSettings(data.settings);
          this.sendMessageToWebview({ type: 'autoApproveSettingsUpdate', settings: autoApproveManager.getSettings() });
        }
        break;
      }

      case 'toggleYoloMode': {
        const agentManager = (this.systemHandler as any).agentManager;
        const autoApproveManager = agentManager.getServiceProvider().getService('autoApproveManager');
        if (autoApproveManager) {
          const settings = autoApproveManager.getSettings();
          settings.yoloMode = data.enabled;
          await autoApproveManager.setSettings(settings);
          this.sendMessageToWebview({ type: 'autoApproveSettingsUpdate', settings });
        }
        break;
      }

      case 'planApprovalResponse': {
        const agentManager = (this.systemHandler as any).agentManager;
        if (agentManager && data.planId) {
          const planningManager = agentManager.getPlanningManager();
          const outcome = await planningManager.resolvePlanApproval(
            data.planId,
            data.approved ? 'approved' : 'rejected',
            data.reason,
            data.source === 'user' ? 'user' : 'system',
            {
              approvalRequestId: data.approvalRequestId
            }
          );
          if (outcome?.resolution && outcome.resolution !== 'applied') {
            this.sendMessageToWebview({
              type: 'systemMessage',
              messageId: `sys_plan_approval_${Date.now()}`,
              content: `[Warning:PLAN_APPROVAL_${String(outcome.resolution).toUpperCase()}] ${outcome.reasonCode} [correlationId=plan:${data.planId}:${outcome.reasonCode}]`,
              code: `PLAN_APPROVAL_${String(outcome.resolution).toUpperCase()}`,
              severity: 'warning',
              correlationId: `plan:${data.planId}:${outcome.reasonCode}`
            } as any);
          }
          const plan = planningManager.getPlan(data.planId);
          if (plan) {
            this.sendMessageToWebview({
              type: 'planCardUpdated',
              plan,
              timestamp: Date.now()
            } as any);
          }
        }
        break;
      }

      case 'webviewUnhandledMessage': {
        const rawType = String((data as any).rawType || 'unknown');
        const correlationId = String((data as any).correlationId || `unknown:webview_message:${rawType}`);
        const count = Number((data as any).count || 1);
        const firstSeenAt = Number((data as any).firstSeenAt || Date.now());
        const lastSeenAt = Number((data as any).lastSeenAt || Date.now());
        const flowId = typeof (data as any).flowId === 'string' ? String((data as any).flowId) : null;
        const diagnosticsContext = this.getDiagnosticsContext();
        DiagnosticService.getInstance()?.recordUnknownEvent({
          kind: 'webview_message',
          origin: 'webview_runtime',
          rawType,
          correlationId,
          flowId,
          mode: diagnosticsContext.mode,
          model: diagnosticsContext.model,
          payload: {
            count,
            firstSeenAt,
            lastSeenAt,
            flowId
          }
        });
        break;
      }

      case 'enhancePrompt':
        await this.systemHandler.handleEnhancePrompt(data.prompt);
        break;

      case 'getValidationMetrics':
        await this.systemHandler.handleGetValidationMetrics();
        break;

      case 'syncTasks':
        if (data.currentPlanId) {
          await this.sessionHandler.updateSessionWithPlan(data.currentPlanId);
        }
        await this.sessionHandler.updateSessionMetadata({ tasks: { plans: data.plans, currentPlanId: data.currentPlanId } });
        break;

      case 'syncContext':
        await this.sessionHandler.updateSessionMetadata({ context: { files: data.files, stats: data.stats } });
        // Make sure the backend ContextManager memory matches the UI
        try {
          const agentManager = (this.systemHandler as any).agentManager; // Hack to access private agentManager
          if (agentManager) {
            agentManager.getContextManager().hydrateContext(data.files, data.stats);
          }
        } catch (e) { }
        break;

      case 'requestCurrentPlan': {
        const agentManager = (this.systemHandler as any).agentManager;
        if (agentManager) {
          const planningManager = agentManager.getPlanningManager();
          const requestedSessionId = typeof (data as any).sessionId === 'string'
            ? String((data as any).sessionId).trim()
            : '';
          const targetSession = requestedSessionId
            ? await this.sessionHandler.getSessionById(requestedSessionId)
            : await this.messageHandler.getSessionManager().getActiveSession(SessionType.CHAT);
          const tasks = targetSession?.metadata?.tasks && typeof targetSession.metadata.tasks === 'object'
            ? targetSession.metadata.tasks as Record<string, unknown>
            : null;
          const scopedPlanId = tasks && typeof tasks.currentPlanId === 'string'
            ? String(tasks.currentPlanId)
            : typeof targetSession?.metadata?.activePlanId === 'string'
              ? String(targetSession.metadata.activePlanId)
              : '';
          planningManager.setCurrentPlanId?.(scopedPlanId || '');
          const currentPlan = scopedPlanId
            ? planningManager.getPlan(scopedPlanId) || null
            : null;
          this.sendMessageToWebview({
            type: 'currentPlanResponse',
            sessionId: targetSession?.id || null,
            plan: currentPlan || null
          });
        }
        break;
      }

      case 'retryStep': {
        const agentManager = (this.systemHandler as any).agentManager;
        if (agentManager && data.planId && data.stepId) {
          agentManager.getPlanningManager().retryStep(data.planId, data.stepId);
          // Send update back to UI
          const plan = agentManager.getPlanningManager().getPlan(data.planId);
          this.sendMessageToWebview({ type: 'planLoaded', plan, planId: data.planId } as any);
        }
        break;
      }

      case 'skipStep': {
        const agentManager = (this.systemHandler as any).agentManager;
        if (agentManager && data.planId && data.stepId) {
          agentManager.getPlanningManager().skipStep(data.planId, data.stepId);
          // Send update back to UI
          const plan = agentManager.getPlanningManager().getPlan(data.planId);
          this.sendMessageToWebview({ type: 'planLoaded', plan, planId: data.planId } as any);
        }
        break;
      }

      case 'requestSessionMetadata': {
        await this.sessionHandler.handleGetSessions();
        break;
      }

      case 'abortPlan': {
        const agentManager = (this.systemHandler as any).agentManager;
        if (agentManager && data.planId) {
          agentManager.getPlanningManager().abortPlan(data.planId);
          const plan = agentManager.getPlanningManager().getPlan(data.planId);
          this.sendMessageToWebview({ type: 'planLoaded', plan, planId: data.planId } as any);
        }
        break;
      }

      case 'showStepResult': {
        if (data.result) {
          // Open a virtual document or just show in extension
          vscode.workspace.openTextDocument({
            content: JSON.stringify(data.result, null, 2),
            language: 'json'
          }).then(doc => vscode.window.showTextDocument(doc));
        }
        break;
      }

      default: {
        const rawType = String((data as any)?.type || 'unknown');
        const correlationId = `unknown:webview_message:${rawType}`;
        const diagnosticsContext = this.getDiagnosticsContext();
        console.warn(`[WebviewMessageHandler] Unknown message type: ${rawType} (correlationId=${correlationId})`);
        DiagnosticService.getInstance()?.recordUnknownEvent({
          kind: 'webview_message',
          origin: 'webview_message_handler',
          rawType,
          correlationId,
          mode: diagnosticsContext.mode,
          model: diagnosticsContext.model,
          payload: {
            keys: Object.keys((data as any) || {})
          }
        });
      }
    }
  }

  getRateLimitStatus() { return this.messageValidator.getRateLimitStatus(); }
  resetRateLimiter(): void { this.messageValidator.resetRateLimiter(); }

  private async sendContextUpdate(_webview: vscode.WebviewView): Promise<void> {
    console.log('[WebviewMessageHandler] Sending context update');
  }

  private async sendWorkspaceInfo(webview: vscode.WebviewView): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    webview.webview.postMessage({
      type: 'workspaceInfo',
      info: { name: folder?.name || 'No workspace', path: folder?.uri.fsPath || 'N/A' }
    });
  }

  private async handleSystemMessageCreated(messageId: string, content: string): Promise<void> {
    const sm = this.messageHandler.getSessionManager();
    if (messageId && content && sm) {
      const activeSession = await sm.getActiveSession(SessionType.CHAT);
      if (activeSession) {
        await sm.getChatProvider()?.addMessage(activeSession.id, {
          role: 'system', content, metadata: { messageId, isSystemMessage: true }
        });
      }
    }
  }

  private async handleCommandApprovalCreated(message: any): Promise<void> {
    const sm = this.messageHandler.getSessionManager();
    if (message?.commandApproval && sm) {
      const active = await sm.getActiveSession(SessionType.CHAT);
      if (active) await sm.getChatProvider()?.addCommandApprovalMessage(active.id, message.commandApproval);
    }
  }

  private async handleCommandApprovalUpdated(message: any): Promise<void> {
    const sm = this.messageHandler.getSessionManager();
    if (message?.commandApproval && sm) {
      const active = await sm.getActiveSession(SessionType.CHAT);
      if (active) {
        await sm.getChatProvider()?.updateCommandApprovalMessage(
          active.id, message.commandApproval.commandId, message.commandApproval.status
        );
      }
    }
  }

  private async handleToolExecutionCreated(message: any): Promise<void> {
    const sm = this.messageHandler.getSessionManager();
    if (message?.toolExecution && sm) {
      const active = await sm.getActiveSession(SessionType.CHAT);
      if (active) await sm.getChatProvider()?.addToolExecutionMessage(active.id, message.toolExecution);
    }
  }

  private async handleToolExecutionUpdated(message: any): Promise<void> {
    const sm = this.messageHandler.getSessionManager();
    if (message?.toolExecution && sm) {
      const active = await sm.getActiveSession(SessionType.CHAT);
      if (active) {
        await sm.getChatProvider()?.updateToolExecutionMessage(
          active.id, message.toolExecution.toolName, {
          isExecuting: message.toolExecution.isExecuting,
          endTime: message.toolExecution.endTime,
          duration: message.toolExecution.duration,
          fileName: message.toolExecution.fileName,
          diffStats: message.toolExecution.diffStats
        }
        );
      }
    }
  }

  private getDiagnosticsContext(): { mode: string; model: string } {
    const context = this.messageHandler?.getContext?.();
    const mode =
      typeof context?.selectedMode === 'string' && context.selectedMode.trim().length > 0
        ? context.selectedMode
        : 'unknown';
    const model =
      typeof context?.selectedModel === 'string' && context.selectedModel.trim().length > 0
        ? context.selectedModel
        : 'unknown';
    return { mode, model };
  }

  private async tryResolvePlanApprovalFromChatText(rawMessage: unknown): Promise<boolean> {
    const message = String(rawMessage || '').trim();
    if (!message) return false;

    const agentManager = (this.systemHandler as any).agentManager;
    const planningManager = agentManager?.getPlanningManager?.();
    const currentPlan = planningManager?.getCurrentPlan?.();

    if (!currentPlan || String(currentPlan.status) !== 'awaiting_approval') {
      return false;
    }

    const intent = this.detectPlanApprovalIntent(message);
    if (!intent) return false;

    const pendingApprovalRequestId = String(currentPlan?.pendingApproval?.approvalRequestId || '').trim();
    const outcome = await planningManager.resolvePlanApproval(
      currentPlan.id,
      intent.decision,
      intent.reason,
      'user',
      {
        approvalRequestId: pendingApprovalRequestId
      }
    );

    if (outcome?.resolution !== 'applied') {
      this.sendMessageToWebview({
        type: 'info',
        message: `Plan-Freigabe konnte nicht übernommen werden (${outcome?.reasonCode || 'unknown'}).`
      });
      return true;
    }

    this.sendMessageToWebview({
      type: 'info',
      message:
        intent.decision === 'approved'
          ? 'Plan wurde im Chat als genehmigt markiert.'
          : 'Plan wurde im Chat als abgelehnt markiert.'
    });

    return true;
  }

  private detectPlanApprovalIntent(message: string): { decision: 'approved' | 'rejected'; reason: string } | null {
    const text = message.trim().toLowerCase();
    if (!text || text.length > 220) return null;

    const hasPlanWord = /\b(plan|planung)\b/i.test(text);
    const hasApprovalWord = /\b(genehmige|genehmigt|freigegeben|freigeben|approve|approved|ok)\b/i.test(text);
    const hasRejectWord = /\b(abgelehnt|ablehnen|reject|rejected)\b/i.test(text);
    const hasNegationApproval = /\b(nicht|kein|keine|no|not)\b.{0,12}\b(genehmigt|freigegeben|approved|approve)\b/i.test(text);

    if (hasPlanWord && hasRejectWord) {
      return { decision: 'rejected', reason: 'rejected_via_chat_text' };
    }

    if (hasPlanWord && hasApprovalWord && !hasNegationApproval) {
      return { decision: 'approved', reason: 'approved_via_chat_text' };
    }

    return null;
  }
}
