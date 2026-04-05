// =====================================================
// Messaging – Bridge between webview and extension
// =====================================================

import { vscodeApi } from './vscode';
import type { OutboundMessage } from './types';

export interface MessageHandlers {
  // State & lifecycle
  onApiKeyStatus?: (data: any) => void;
  onModelsList?: (data: any) => void;
  onModelChanged?: (data: any) => void;
  onQueryRuntimeEvent?: (data: any) => void;
  onResilienceStatus?: (data: any) => void;
  onSubagentStatus?: (data: any) => void;
  onModeChanged?: (data: any) => void;
  onError?: (data: any) => void;
  onInfo?: (data: any) => void;

  // Messages
  onAssistantMessage?: (data: any) => void;
  onUserMessage?: (data: any) => void;
  onAssistantMessageEnd?: (data: any) => void;
  onSystemMessage?: (data: any) => void;
  onLoadMessages?: (data: any) => void;
  onClearMessages?: (data: any) => void;
  onMessagesCompressed?: (data: any) => void;

  // Generation state
  onGeneratingStart?: () => void;
  onGeneratingEnd?: () => void;
  onProcessingStart?: () => void;
  onProcessingEnd?: () => void;

  // Sessions
  onSessionsUpdate?: (data: any) => void;

  // Context
  onContextUpdate?: (data: any) => void;

  // Approvals & tools
  onApprovalRequest?: (data: any) => void;
  onToolExecutionStart?: (data: any) => void;
  onToolComplete?: (data: any) => void;
  onCommandKilled?: (data: any) => void;
  onAutoApproveSettingsUpdate?: (data: any) => void;
  onToolApprovalRequest?: (data: any) => void;
  onToolApprovalResolved?: (data: any) => void;
  onQuestionRequest?: (data: any) => void;
  onQuestionResolved?: (data: any) => void;

  // Checkpoints
  onCheckpointRestored?: (data: any) => void;
  onCheckpointRestorePlanned?: (data: any) => void;
  onCheckpointRestoreError?: (data: any) => void;
  onCheckpoints?: (data: any) => void;
  onCheckpointCreated?: (data: any) => void;
  onCheckpointDiffReady?: (data: any) => void;

  // Plans
  onPlanCardCreated?: (data: any) => void;
  onPlanCardUpdated?: (data: any) => void;
  onPlanUpdated?: (data: any) => void;
  onPlanLoaded?: (data: any) => void;
  onPlanStatusUpdate?: (data: any) => void;
  onStepStatusUpdate?: (data: any) => void;
  onPlanStepCompleted?: (data: any) => void;
  onPlanApprovalRequested?: (data: any) => void;
  onPlanApprovalResolved?: (data: any) => void;
  onStopAcknowledged?: (data: any) => void;
  onExecutionStateUpdate?: (data: any) => void;
  onHandoverProgress?: (data: any) => void;
  onCurrentPlanResponse?: (data: any) => void;

  // Terminal
  onTerminalOutputChunk?: (data: any) => void;
  onTerminalModeChanged?: (data: any) => void;
  onTerminalStatus?: (data: any) => void;

  // Files
  onAddFileReference?: (data: any) => void;
  onFileSearchResults?: (data: any) => void;
  onFilePreviewContent?: (data: any) => void;

  // Prompt enhancement
  onPromptEnhancing?: (data: any) => void;
  onPromptEnhanced?: (data: any) => void;
  onPromptEnhanceError?: (data: any) => void;

  // Guardian
  onSetPromptFromGuardian?: (data: any) => void;

  // Misc
  onActivityUpdate?: (data: any) => void;
  onWorkspaceInfo?: (data: any) => void;
  onThinking?: (data: any) => void;
  onTokenTrackerUpdate?: (data: any) => void;
  onRestoreSessionState?: (data: any) => void;

  // Catch-all for unhandled types
  onUnhandled?: (data: any) => void;

  // New handlers
  onTaskStart?: (data: any) => void;
  onTaskUpdate?: (data: any) => void;
  onTaskComplete?: (message: any) => void;
  onTaskProgress?: (message: any) => void;
  onRefreshSessions?: (message: any) => void;

}


// Map from message type to handler key
const TYPE_TO_HANDLER: Record<string, keyof MessageHandlers> = {
  apiKeyStatus: 'onApiKeyStatus',
  modelsList: 'onModelsList',
  modelChanged: 'onModelChanged',
  queryRuntimeEvent: 'onQueryRuntimeEvent',
  resilienceStatus: 'onResilienceStatus',
  subagentStatus: 'onSubagentStatus',
  modeChanged: 'onModeChanged',
  error: 'onError',
  info: 'onInfo',
  assistantMessage: 'onAssistantMessage',
  userMessage: 'onUserMessage',
  assistantMessageEnd: 'onAssistantMessageEnd',
  systemMessage: 'onSystemMessage',
  loadMessages: 'onLoadMessages',
  clearMessages: 'onClearMessages',
  messagesCompressed: 'onMessagesCompressed',
  generatingStart: 'onGeneratingStart',
  generatingEnd: 'onGeneratingEnd',
  processingStart: 'onProcessingStart',
  processingEnd: 'onProcessingEnd',
  sessionsUpdate: 'onSessionsUpdate',
  contextUpdate: 'onContextUpdate',
  approvalRequest: 'onApprovalRequest',
  toolExecutionStart: 'onToolExecutionStart',
  toolComplete: 'onToolComplete',
  commandKilled: 'onCommandKilled',
  autoApproveSettingsUpdate: 'onAutoApproveSettingsUpdate',
  toolApprovalRequest: 'onToolApprovalRequest',
  toolApprovalResolved: 'onToolApprovalResolved',
  questionRequest: 'onQuestionRequest',
  questionResolved: 'onQuestionResolved',
  checkpointRestored: 'onCheckpointRestored',
  checkpointRestorePlanned: 'onCheckpointRestorePlanned',
  checkpointRestoreError: 'onCheckpointRestoreError',
  checkpoints: 'onCheckpoints',
  checkpointCreated: 'onCheckpointCreated',
  checkpointDiffReady: 'onCheckpointDiffReady',
  planCardCreated: 'onPlanCardCreated',
  planCardUpdated: 'onPlanCardUpdated',
  planUpdated: 'onPlanUpdated',
  planLoaded: 'onPlanLoaded',
  planStatusUpdate: 'onPlanStatusUpdate',
  stepStatusUpdate: 'onStepStatusUpdate',
  planStepCompleted: 'onPlanStepCompleted',
  planApprovalRequested: 'onPlanApprovalRequested',
  planApprovalResolved: 'onPlanApprovalResolved',
  stopAcknowledged: 'onStopAcknowledged',
  executionStateUpdate: 'onExecutionStateUpdate',
  handoverProgress: 'onHandoverProgress',
  currentPlanResponse: 'onCurrentPlanResponse',
  terminalOutputChunk: 'onTerminalOutputChunk',
  terminalModeChanged: 'onTerminalModeChanged',
  terminalStatus: 'onTerminalStatus',
  addFileReference: 'onAddFileReference',
  fileSearchResults: 'onFileSearchResults',
  filePreviewContent: 'onFilePreviewContent',
  promptEnhancing: 'onPromptEnhancing',
  promptEnhanced: 'onPromptEnhanced',
  promptEnhanceError: 'onPromptEnhanceError',
  setPromptFromGuardian: 'onSetPromptFromGuardian',
  activityUpdate: 'onActivityUpdate',
  workspaceInfo: 'onWorkspaceInfo',
  thinking: 'onThinking',
  taskStart: 'onTaskStart',
  taskUpdate: 'onTaskUpdate',
  taskComplete: 'onTaskComplete',
  taskProgress: 'onTaskProgress',
  refreshSessions: 'onRefreshSessions',
  tokenTrackerUpdate: 'onTokenTrackerUpdate',
  restoreSessionState: 'onRestoreSessionState',
};


let _handlers: MessageHandlers = {};
let _initialized = false;

function handleMessage(event: MessageEvent): void {
  const message = event.data as OutboundMessage;
  if (!message || !message.type) return;

  const handlerKey = TYPE_TO_HANDLER[message.type];
  if (handlerKey) {
    const handler = _handlers[handlerKey];
    if (handler) {
      (handler as Function)(message);
    }
    return;
  }

  if (_handlers.onUnhandled) {
    _handlers.onUnhandled(message);
  }
}

/**
 * Initialize messaging bridge.
 * Automatically sends 'ready' to trigger ChatViewProvider.initializeWebviewData().
 */
export function init(handlers: MessageHandlers): void {
  if (_initialized) {
    // Update handlers without re-registering listener
    _handlers = { ..._handlers, ...handlers };
    return;
  }

  _handlers = handlers;
  _initialized = true;

  window.addEventListener('message', handleMessage);

  // Notify the extension that the webview is ready
  vscodeApi.postMessage({ type: 'ready' });
}

/**
 * Send a message to the extension backend.
 */
export function send(type: string, payload: Record<string, any> = {}): boolean {
  try {
    vscodeApi.postMessage({ type, ...payload });
    return true;
  } catch (error) {
    console.error('[messaging] Failed to post message to extension host:', {
      type,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Update handlers at runtime (e.g., when a component mounts).
 */
export function updateHandlers(handlers: Partial<MessageHandlers>): void {
  _handlers = { ..._handlers, ...handlers };
}

/**
 * Clean up message listener.
 */
export function destroy(): void {
  window.removeEventListener('message', handleMessage);
  _handlers = {};
  _initialized = false;
}

export const messaging = { init, send, updateHandlers, destroy };
