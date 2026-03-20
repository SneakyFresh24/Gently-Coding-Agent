import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { FileReferenceManager } from '../../../agent/fileReferenceManager';
// Base styles and types
import { ChatViewContext, Message, fromChatMessage } from '../types/ChatTypes';
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

export class MessageHandler {
  private context!: ChatViewContext;
  private architectHandoverHandler: ArchitectHandoverHandler;
  private sessionHistoryManager: SessionHistoryManager;
  private toolCallManager: ToolCallManager;
  private flowManager: ChatFlowManager;

  constructor(
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly openRouterService: OpenRouterService,
    private readonly agentManager: AgentManager,
    private readonly modeService: ModeService,
    private readonly sendMessageToWebview: (message: OutboundWebviewMessage) => void,
    private readonly updateConversationHistory: (message: Message) => void
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
        () => ({ valid: true, issues: [] }), // Simplified validation for now
        () => true, // Simplified repair for now
        (msg: string, retry: number, isFollow: boolean) => this.flowManager.generateAndStreamResponse(this.context, msg, retry, isFollow)
    );

    const dispatcher = new ToolCallDispatcher(
      this.toolCallManager, 
      followUp, 
      sendMessageToWebview,
      this.agentManager,
      updateConversationHistory,
      (m: string | undefined) => followUp.sendFollowUpMessage(this.context, m || '')
    );

    this.flowManager = new ChatFlowManager(agentManager, this.sessionHistoryManager, refParser, promptMgr, streaming, pruner, this.toolCallManager, dispatcher, this.modeService, sendMessageToWebview, openRouterService);

    this.context = { agentMode: false, selectedModel: 'glm-4.6', selectedMode: 'ask', conversationHistory: [], shouldStopStream: false, shouldAbortTools: false, messageCheckpoints: new Map(), toolExecutionStartSent: new Set() };

    this.loadStoredState();
    this.sessionHistoryManager.initializeSession(this.context);
  }

  private initializeNewToolCallSystem(): void {
    const planning = this.agentManager.getPlanningManager();
    if (planning) planning.addListener((e: any) => this.architectHandoverHandler.handlePlanEvent(e, this.context));
  }

  async sendMessage(userMessage: string, silent: boolean = false, fileReferences?: any[], retryCount: number = 0): Promise<void> {
    await this.flowManager.handleUserMessage(this.context, userMessage, { silent, fileReferences, retryCount });
  }

  private loadStoredState(): void {
    this.context.agentMode = this.extensionContext.globalState.get('gently.agentMode', false);
    this.context.selectedModel = this.extensionContext.globalState.get('gently.selectedModel', 'glm-4.6');
    this.context.selectedMode = this.extensionContext.globalState.get('gently.selectedMode', 'ask');
  }

  setSelectedMode(modeId: string): void {
    this.context.selectedMode = modeId;
    this.context.agentMode = modeId === 'agent';
    this.extensionContext.globalState.update('gently.selectedMode', modeId);
    this.extensionContext.globalState.update('gently.agentMode', this.context.agentMode);
  }

  setSelectedModel(model: string): void {
    this.context.selectedModel = model;
    this.extensionContext.globalState.update('gently.selectedModel', model);
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
