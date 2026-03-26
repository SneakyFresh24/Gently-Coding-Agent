import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { FileReferenceManager } from '../../../agent/fileReferenceManager';
// Base styles and types
import { ChatViewContext, Message, fromChatMessage, toChatMessage } from '../types/ChatTypes';
import { OpenRouterService } from '../../../services/OpenRouterService';
import { ToolCallManager } from '../toolcall';

// Refactored Handlers
// Refactored Consolidated Handlers
import { ConversationPruner, PromptManager, ReferenceParser } from './ContextGenerators';
import { FollowUpHandler, ArchitectHandoverHandler } from './SequenceManagers';
import { ToolCallDispatcher } from './ExecutionDispatchers';
import { SessionHistoryManager } from './SessionHistoryManager';
import { ModeService } from '../../../modes/ModeService';
import { StreamingService } from './StreamingService';
import { ChatFlowManager } from './ChatFlowManager';
import { OutboundWebviewMessage } from '../types/WebviewMessageTypes';
import { SessionType } from '../../../services/HistoryManager';

export class MessageHandler {
  private context!: ChatViewContext;
  private architectHandoverHandler: ArchitectHandoverHandler;
  private sessionHistoryManager: SessionHistoryManager;
  private toolCallManager: ToolCallManager;
  private flowManager: ChatFlowManager;
  private availableModelIds = new Set<string>();

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly openRouterService: OpenRouterService,
    private readonly agentManager: AgentManager,
    private readonly modeService: ModeService,
    private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
    private readonly updateConversationHistory: (message: Message) => void,
    private readonly onModeSwitch?: (modeId: string) => Promise<void>
  ) {
    const fileRef = new FileReferenceManager(agentManager.getFileOperations(), agentManager.getIndexer());
    this.architectHandoverHandler = new ArchitectHandoverHandler(sendMessageToWebview);
    
    // Get message handler from planning manager
    const planning = this.agentManager.getPlanningManager();
    const messageHandler = planning?.getMessageHandler();
    
    const streaming = new StreamingService(openRouterService, sendMessageToWebview, messageHandler);
    const refParser = new ReferenceParser(fileRef);
    const pruner = new ConversationPruner(openRouterService, agentManager);

    this.toolCallManager = new ToolCallManager(this.agentManager);
    this.initializeNewToolCallSystem();

    this.sessionHistoryManager = new SessionHistoryManager(extensionContext, agentManager.getServiceProvider().getService('sessionManager'), sendMessageToWebview);
    const promptMgr = new PromptManager(agentManager, this.modeService);

    const followUp = new FollowUpHandler(
        this.toolCallManager as any, // Cast temporarily if types mismatch during migration
        sendMessageToWebview,
        (messages: Message[]) => {
          const validation = this.toolCallManager.validateMessageSequence(messages.map(toChatMessage));
          return { valid: validation.valid, issues: validation.errors };
        },
        (messages: Message[]) => {
          const repair = this.toolCallManager.repairConversationHistory(messages.map(toChatMessage));
          return {
            repaired: repair.repaired,
            messages: repair.messages.map((msg: any) => fromChatMessage(msg)),
            fixes: repair.fixes
          };
        },
        (msg: string, retry: number, isFollow: boolean) => this.flowManager.generateAndStreamResponse(this.context, msg, retry, isFollow),
        async () => {
          const storedModel = this.extensionContext.globalState.get<string | null>('gently.selectedModel', null);
          const recoveredModel = this.normalizeModelIdForRecovery(storedModel);
          if (recoveredModel) {
            this.context.selectedModel = recoveredModel;
          }
          return recoveredModel;
        }
    );

    const dispatcher = new ToolCallDispatcher(
      this.toolCallManager, 
      followUp, 
      sendMessageToWebview,
      this.agentManager,
      updateConversationHistory,
      (m: string | undefined) => followUp.sendFollowUpMessage(this.context, m || ''),
      async (modeId: string) => {
        if (this.onModeSwitch) {
          await this.onModeSwitch(modeId);
          return;
        }
        this.setSelectedMode(modeId);
      },
      async (message: string) => {
        await this.sendMessage(message, false);
      }
    );

    this.flowManager = new ChatFlowManager(
      agentManager,
      this.sessionHistoryManager,
      refParser,
      promptMgr,
      streaming,
      pruner,
      this.toolCallManager,
      dispatcher,
      this.modeService,
      sendMessageToWebview,
      openRouterService,
      async () => {
        await this.setSelectedModel(null);
      }
    );

    this.context = {
      agentMode: false,
      selectedModel: null,
      selectedMode: 'ask',
      conversationHistory: [],
      shouldStopStream: false,
      shouldAbortTools: false,
      messageCheckpoints: new Map(),
      toolExecutionStartSent: new Set(),
      sequenceRepairHistory: [],
      sequenceRetryCount: 0,
      consecutiveMistakeCount: 0,
      recentToolCallFingerprints: [],
      doomLoopAllowedTools: new Set<string>(),
      recentModeSwitches: [],
      isToolExecutionActive: false
    };

    this.loadStoredState();
    this.sessionHistoryManager.initializeSession(this.context);
  }

  private initializeNewToolCallSystem(): void {
    const planning = this.agentManager.getPlanningManager();
    if (planning) planning.addListener((e: any) => this.architectHandoverHandler.handlePlanEvent(e, this.context));
  }

  async sendMessage(userMessage: string, silent: boolean = false, fileReferences?: any[], retryCount: number = 0): Promise<void> {
    if (!this.isValidOpenRouterModelId(this.context.selectedModel)) {
      this.sendMessageToWebview({
        type: 'error',
        message: 'Please select a valid OpenRouter model before sending a message.'
      });
      return;
    }
    await this.flowManager.handleUserMessage(this.context, userMessage, { silent, fileReferences, retryCount });
  }

  private loadStoredState(): void {
    this.context.agentMode = this.extensionContext.globalState.get('gently.agentMode', false);
    const storedModel = this.extensionContext.globalState.get<string | null>('gently.selectedModel', null);
    this.context.selectedModel = this.normalizeModelId(storedModel);
    this.context.selectedMode = this.extensionContext.globalState.get('gently.selectedMode', 'ask');
  }

  setSelectedMode(modeId: string): void {
    this.context.selectedMode = modeId;
    this.context.agentMode = modeId === 'agent';
    this.extensionContext.globalState.update('gently.selectedMode', modeId);
    this.extensionContext.globalState.update('gently.agentMode', this.context.agentMode);
  }

  async setSelectedModel(model: string | null): Promise<void> {
    const normalizedModel = this.normalizeModelId(model);
    this.context.selectedModel = normalizedModel;
    await this.extensionContext.globalState.update('gently.selectedModel', normalizedModel);
    await this.persistSelectedModelToActiveSession(normalizedModel);
    this.sendMessageToWebview({ type: 'modelChanged', model: normalizedModel || '' } as any);
    this.sendMessageToWebview({ type: 'refreshSessions' } as any);
  }

  setAvailableModels(models: Array<{ id: string }> | string[]): void {
    const ids = models.map((m) => typeof m === 'string' ? m : m.id).filter((id) => typeof id === 'string' && id.trim().length > 0);
    this.availableModelIds = new Set(ids);
    if (this.context.selectedModel && !this.isStructurallyValidOpenRouterModelId(this.context.selectedModel)) {
      this.context.selectedModel = null;
      void this.extensionContext.globalState.update('gently.selectedModel', null);
      void this.persistSelectedModelToActiveSession(null);
      this.sendMessageToWebview({ type: 'modelChanged', model: '' } as any);
      return;
    }

    if (this.context.selectedModel && !this.isValidOpenRouterModelId(this.context.selectedModel)) {
      console.warn(`[MessageHandler] Model "${this.context.selectedModel}" is not in the current model list. Keeping selection to avoid race-condition model loss during refresh.`);
    }
  }

  async applySessionState(sessionMessages: any[], sessionModel: string | null): Promise<void> {
    this.context.conversationHistory = (sessionMessages || [])
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool'))
      .map((m: any) => {
        const message = fromChatMessage({
          role: m.role,
          content: m.content || '',
          tool_call_id: m.tool_call_id,
          tool_calls: m.tool_calls
        }, m.id);
        message.toolName = m.toolName || m.metadata?.toolName;
        return message;
      });

    const normalizedModel = this.normalizeModelId(sessionModel);
    this.context.selectedModel = normalizedModel;
    await this.extensionContext.globalState.update('gently.selectedModel', normalizedModel);
    this.sendMessageToWebview({ type: 'modelChanged', model: normalizedModel || '' } as any);
  }

  private normalizeModelId(model: string | null | undefined): string | null {
    if (typeof model !== 'string') return null;
    const trimmed = model.trim();
    if (!this.isValidOpenRouterModelId(trimmed)) return null;
    return trimmed;
  }

  private normalizeModelIdForRecovery(model: string | null | undefined): string | null {
    if (typeof model !== 'string') return null;
    const trimmed = model.trim();
    if (!this.isStructurallyValidOpenRouterModelId(trimmed)) return null;
    return trimmed;
  }

  private isValidOpenRouterModelId(model: string | null | undefined): model is string {
    if (!this.isStructurallyValidOpenRouterModelId(model)) return false;
    const trimmed = (model as string).trim();

    // If we have a fresh model list, enforce strict whitelist.
    if (this.availableModelIds.size > 0) {
      return this.availableModelIds.has(trimmed);
    }

    // Fallback validation when list is not available yet.
    return true;
  }

  private isStructurallyValidOpenRouterModelId(model: string | null | undefined): model is string {
    if (typeof model !== 'string') return false;
    const trimmed = model.trim();
    if (!trimmed) return false;

    // Explicitly block legacy/internal pseudo IDs.
    const disallowed = new Set(['unknown', 'glm-4.6', 'deepseek-chat']);
    if (disallowed.has(trimmed)) return false;
    return /^[^/\s]+\/[^/\s]+$/.test(trimmed);
  }

  private async persistSelectedModelToActiveSession(model: string | null): Promise<void> {
    const activeSession = await this.sessionHistoryManager.getActiveSession(SessionType.CHAT);
    if (!activeSession) return;

    const metadata = { ...(activeSession.metadata || {}) };
    if (model) {
      metadata.model = model;
    } else {
      delete metadata.model;
    }

    const chatProvider = this.sessionHistoryManager.getChatProvider();
    if (chatProvider) {
      await chatProvider.updateSession(activeSession.id, { metadata });
    }
  }

  getSessionManager(): SessionHistoryManager {
    return this.sessionHistoryManager;
  }

  stopMessage(): void {
    this.context.shouldStopStream = true;
    this.context.shouldAbortTools = true; // Flag for potential future use in execution loops
    
    // Abort active tool executions & approvals
    this.agentManager.getToolManager().abortAllExecutions();

    this.sendMessageToWebview({ type: 'assistantMessageEnd', messageId: this.context.currentMessageId || '' });
    this.sendMessageToWebview({ type: 'processingEnd' });
    this.sendMessageToWebview({ type: 'generatingEnd' });
  }


  clearHistory(): void {
    this.context.conversationHistory = [];
    this.sendMessageToWebview({ type: 'clearMessages' });
  }

  dispose(): void {
    this.toolCallManager.dispose();
    if ('dispose' in this.flowManager) (this.flowManager as any).dispose();
  }

  getContext(): ChatViewContext { return this.context; }
}
