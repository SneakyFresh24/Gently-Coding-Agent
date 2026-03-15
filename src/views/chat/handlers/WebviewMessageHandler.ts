// =====================================================
// Webview Message Handler – BYOK Edition (no auth)
// =====================================================

import * as vscode from 'vscode';
import { MessageHandler } from './MessageHandler';
import { SessionHandler } from './SessionHandler';
import { FileHandler } from './FileHandler';
import { SystemHandler } from './SystemHandler';
import { WebviewMessage } from '../types/ChatTypes';
import { SessionType } from '../../../session/types/SessionTypes';
import { MessageValidator } from '../validation';
import { ApiKeyManager } from '../../../services/ApiKeyManager';
import { OpenRouterService } from '../../../services/OpenRouterService';

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
          this.sendMessageToWebview({ type: 'modelsList', models });
        } catch (error: any) {
          console.error('[WebviewMessageHandler] Error fetching models:', error);
          this.sendMessageToWebview({ type: 'error', message: 'Failed to fetch OpenRouter models: ' + error.message });
        }
        break;
      }

      case 'toggleAgentMode':
        this.messageHandler.setSelectedMode(data.enabled ? 'agent' : 'ask');
        break;

      case 'modelChanged':
        // Accept any OpenRouter model slug
        this.messageHandler.setSelectedModel(data.model as any);
        console.log(`[WebviewMessageHandler] Model changed: ${data.model}`);
        break;

      case 'modeChanged':
        console.log(`[WebviewMessageHandler] Mode change: ${data.modeId}`);
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
        this.messageHandler.stopMessage();
        break;

      case 'getWorkspaceInfo':
        await this.sendWorkspaceInfo(webview);
        break;

      case 'getIndexingStats':
        console.log('[WebviewMessageHandler] getIndexingStats requested');
        break;

      case 'refreshIndexing':
        console.log('[WebviewMessageHandler] refreshIndexing requested');
        break;

      case 'addSourceFolder':
        vscode.window.showInformationMessage('Add source folder feature coming soon!');
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
            const result = await agentManager.restoreCheckpoint(data.checkpointId);
            if (result.success) {
              vscode.window.showInformationMessage(`✅ Checkpoint erfolgreich wiederhergestellt: ${result.filesRestored.length} Dateien.`);
              this.sendMessageToWebview({
                type: 'checkpointRestored',
                checkpointId: data.checkpointId,
                messageId: data.messageId,
                checkpointNumber: result.checkpointNumber || 0,
                filesRestored: result.filesRestored
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
            const checkpoints = agentManager.getCheckpointManager().getCheckpointsForMessage(data.messageId);
            this.sendMessageToWebview({
              type: 'checkpoints',
              messageId: data.messageId,
              checkpoints: checkpoints.map((cp: any) => ({
                id: cp.id,
                checkpointNumber: cp.checkpointNumber,
                description: cp.description,
                timestamp: cp.timestamp
              }))
            });
          }
        } catch (error) {
          console.error('[WebviewMessageHandler] Error fetching checkpoints:', error);
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
        await this.sessionHandler.handleNewSession();
        break;

      case 'switchSession':
        await this.sessionHandler.handleSwitchSession(data.sessionId);
        break;

      case 'sessionAction':
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
          const currentPlan = planningManager.getCurrentPlan();
          this.sendMessageToWebview({
            type: 'currentPlanResponse',
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

      default:
        console.warn(`[WebviewMessageHandler] Unknown message type: ${(data as any).type}`);
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
}