// =====================================================
// Webview Message Types - Complete type definitions for all webview communication
// =====================================================

import { FileReference } from '../../../agent/fileReferenceManager';
import { ToolCall } from '../../../services/OpenRouterService';
import { CommandApproval, ToolExecution, Checkpoint, Message } from './ChatTypes';
import {
  ApprovalRequest,
  TerminalMode,
  QuickPattern,
  AutoApprovalSettings as AutoApproveSettings
} from '../../../types/approval';
import { OutputChunk } from '../../../terminal/execution/types/ExecutionTypes';

// =====================================================
// INBOUND MESSAGES (Webview → Extension)
// =====================================================

/**
 * Webview initialization complete
 */
export interface ReadyMessage {
  type: 'ready';
}

/**
 * User sends a chat message
 */
export interface SendMessageMessage {
  type: 'sendMessage';
  message: string;
  fileReferences?: FileReference[];
}

/**
 * User clears chat history
 */
export interface ClearHistoryMessage {
  type: 'clearHistory';
}

/**
 * Set OpenRouter API key
 */
export interface SetApiKeyMessage {
  type: 'setApiKey';
  key: string;
}

/**
 * Message from webview to update max output tokens
 */
export interface SetMaxTokensMessage {
  type: 'setMaxTokens';
  maxTokens: number;
}

/**
 * Delete OpenRouter API key
 */
export interface DeleteApiKeyMessage {
  type: 'deleteApiKey';
}

/**
 * Check OpenRouter API key status
 */
export interface CheckApiKeyMessage {
  type: 'checkApiKey';
}

/**
 * Fetch OpenRouter models
 */
export interface FetchModelsMessage {
  type: 'fetchModels';
}

/**
 * Toggle agent mode on/off
 */
export interface ToggleAgentModeMessage {
  type: 'toggleAgentMode';
  enabled: boolean;
}

/**
 * AI model changed
 */
export interface ModelChangedMessage {
  type: 'modelChanged';
  model: string;
}

/**
 * Chat mode set (alias for modeChanged)
 */
export interface SetModeMessage {
  type: 'setMode';
  modeId: string;
}

/**
 * Request context update
 */
export interface RequestContextUpdateMessage {
  type: 'requestContextUpdate';
}

/**
 * Add files to context via file picker
 */
export interface AddFilesToContextMessage {
  type: 'addFilesToContext';
}

/**
 * Pin/unpin a file from context
 */
export interface TogglePinFileMessage {
  type: 'togglePinFile';
  filePath: string;
}

/**
 * Stop current message generation
 */
export interface StopMessageMessage {
  type: 'stopMessage';
}

/**
 * Get workspace information
 */
export interface GetWorkspaceInfoMessage {
  type: 'getWorkspaceInfo';
}

/**
 * Open memories panel
 */
export interface OpenMemoriesMessage {
  type: 'openMemories';
}

/**
 * Open a file in editor
 */
export interface OpenFileMessage {
  type: 'openFile';
  path: string;
}

/**
 * Search for files in workspace
 */
export interface SearchFilesMessage {
  type: 'searchFiles';
  query: string;
}

/**
 * Open file picker dialog
 */
export interface OpenFilePickerMessage {
  type: 'openFilePicker';
}

/**
 * Request file preview content
 */
export interface RequestFilePreviewMessage {
  type: 'requestFilePreview';
  path: string;
}

/**
 * Revert to a checkpoint
 */
export interface RevertCheckpointMessage {
  type: 'revertCheckpoint';
  checkpointId: string;
  messageId: string;
  mode?: 'files' | 'task' | 'files&task';
}

export interface GetCheckpointDiffMessage {
  type: 'getCheckpointDiff';
  fromCheckpointId: string;
  toCheckpointId?: string;
}

/**
 * Fetch checkpoints for a message
 */
export interface GetCheckpointsMessage {
  type: 'getCheckpoints';
  messageId: string;
}

/**
 * System message created
 */
export interface SystemMessageCreatedMessage {
  type: 'systemMessageCreated';
  messageId: string;
  content: string;
}

/**
 * Command approval created
 */
export interface CommandApprovalCreatedMessage {
  type: 'commandApprovalCreated';
  message: {
    commandApproval: CommandApproval;
  };
}

/**
 * Command approval status updated
 */
export interface CommandApprovalUpdatedMessage {
  type: 'commandApprovalUpdated';
  message: {
    commandApproval: CommandApproval;
  };
}

/**
 * Tool execution started
 */
export interface ToolExecutionCreatedMessage {
  type: 'toolExecutionCreated';
  message: {
    toolExecution: ToolExecution;
  };
}

/**
 * Tool execution status updated
 */
export interface ToolExecutionUpdatedMessage {
  type: 'toolExecutionUpdated';
  message: {
    toolExecution: ToolExecution;
  };
}

/**
 * Get all sessions
 */
export interface GetSessionsMessage {
  type: 'getSessions';
}

/**
 * Create a new session
 */
export interface NewSessionMessage {
  type: 'newSession';
}

/**
 * Switch to a different session
 */
export interface SwitchSessionMessage {
  type: 'switchSession';
  sessionId: string;
}

/**
 * Perform action on session (rename, delete, pin, etc.)
 */
export interface SessionActionMessage {
  type: 'sessionAction';
  action: string;
  sessionId: string;
  payload?: Record<string, unknown>;
}

/**
 * Search sessions
 */
export interface SearchSessionsMessage {
  type: 'searchSessions';
  query: string;
}

/**
 * Refresh sessions list
 */
export interface RefreshSessionsMessage {
  type: 'refreshSessions';
}

/**
 * Approve/reject command execution
 */
export interface CommandApprovalResponseMessage {
  type: 'commandApprovalResponse';
  commandId: string;
  response: 'accept' | 'accept_always' | 'deny';
}

/**
 * Kill a running command
 */
export interface KillCommandMessage {
  type: 'killCommand';
  commandId: string;
}

/**
 * Set terminal mode (manual/smart)
 */
export interface SetTerminalModeMessage {
  type: 'setTerminalMode';
  mode: 'manual' | 'smart';
}

/**
 * Toggle quick pattern
 */
export interface ToggleQuickPatternMessage {
  type: 'toggleQuickPattern';
  name: string;
  enabled: boolean;
}

/**
 * Enhance a prompt using AI
 */
export interface EnhancePromptMessage {
  type: 'enhancePrompt';
  prompt: string;
}

/**
 * Get validation metrics
 */
export interface GetValidationMetricsMessage {
  type: 'getValidationMetrics';
}


/**
 * Navigate to file location
 */
export interface NavigateToFileMessage {
  type: 'navigateToFile';
  filePath: string;
  lineNumber?: number;
}


/**
 * Add a memory
 */
export interface AddMemoryMessage {
  type: 'addMemory';
  content: string;
  category?: string;
}

/**
 * Delete a memory
 */
export interface DeleteMemoryMessage {
  type: 'deleteMemory';
  id: string;
}

/**
 * Sync tasks payload from webview
 */
export interface SyncTasksMessage {
  type: 'syncTasks';
  plans: any[];
  currentPlanId: string | null;
}

/**
 * Sync context payload from webview
 */
export interface SyncContextMessage {
  type: 'syncContext';
  files: any[];
  stats: any;
}

/**
 * Request current plan from backend
 */
export interface RequestCurrentPlanMessage {
  type: 'requestCurrentPlan';
}

/**
 * Retry a specific plan step
 */
export interface RetryStepMessage {
  type: 'retryStep';
  planId: string;
  stepId: string;
}

/**
 * Skip a specific plan step
 */
export interface SkipStepMessage {
  type: 'skipStep';
  planId: string;
  stepId: string;
}

/**
 * Request session metadata
 */
export interface RequestSessionMetadataMessage {
  type: 'requestSessionMetadata';
}

/**
 * Abort current plan
 */
export interface AbortPlanMessage {
  type: 'abortPlan';
  planId: string;
}

/**
 * Show result for a step
 */
export interface ShowStepResultMessage {
  type: 'showStepResult';
  planId: string;
  stepId: string;
  result: any;
}

/**
 * Set auto-approve settings
 */
export interface SetAutoApproveSettingsMessage {
  type: 'setAutoApproveSettings';
  settings: AutoApproveSettings;
}

/**
 * Toggle YOLO mode
 */
export interface ToggleYoloModeMessage {
  type: 'toggleYoloMode';
  enabled: boolean;
}

/**
 * Response to a tool approval request
 */
export interface ToolApprovalResponseMessage {
  type: 'toolApprovalResponse';
  approvalId: string;
  approved: boolean;
  alwaysApprove: boolean;
}

/**
 * Get chat history
 */
export interface GetHistoryMessage {
  type: 'getHistory';
}

/**
 * Delete a session
 */
export interface DeleteSessionMessage {
  type: 'deleteSession';
  sessionId: string;
}

/**
 * Load a session
 */
export interface LoadSessionMessage {
  type: 'loadSession';
  sessionId: string;
}

/**
 * Get current token usage
 */
export interface GetTokenUsageMessage {
  type: 'getTokenUsage';
}

// =====================================================
// OUTBOUND MESSAGES (Extension → Webview)
// =====================================================

/**
 * Auto-approve settings updated
 */
export interface AutoApproveSettingsUpdateMessage {
  type: 'autoApproveSettingsUpdate';
  settings: AutoApproveSettings;
}

/**
 * Tool approval request
 */
export interface ToolApprovalRequestMessage {
  type: 'toolApprovalRequest';
  approvalId: string;
  toolName: string;
  params: any;
  timestamp: number;
}

/**
 * API Key status update
 */
export interface ApiKeyStatusMessage {
  type: 'apiKeyStatus';
  hasKey: boolean;
  error?: string;
}

/**
 * OpenRouter models list
 */
export interface ModelsListMessage {
  type: 'modelsList';
  models: { id: string; name: string; context_length: number; max_output: number }[];
}

/**
 * Active model changed (Extension → Webview)
 */
export interface ActiveModelChangedMessage {
  type: 'modelChanged';
  model: string;
}

/**
 * Retry with reduced output tokens after context-length error
 */
export interface RetryingWithReducedTokensMessage {
  type: 'retryingWithReducedTokens';
  originalMax: number;
  newMax: number;
  reason: 'context_length';
}

/**
 * Retry with backoff after provider rate-limit
 */
export interface RetryingRateLimitMessage {
  type: 'retryingRateLimit';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  model: string;
}

/**
 * Retry with backoff after tool-call sequence repair
 */
export interface RetryStatusMessage {
  type: 'retryStatus';
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: 'tool_call_sequence';
  model: string;
  fixes?: string[];
}

/**
 * Sessions list updated
 */
export interface SessionsUpdateMessage {
  type: 'sessionsUpdate';
  groups: Array<{
    label: string;
    sessions: Record<string, unknown>[];
  }>;
  activeSessionId: string | null;
}

/**
 * Load messages from a session
 */
export interface LoadMessagesMessage {
  type: 'loadMessages';
  messages: Message[];
}

/**
 * Clear all messages
 */
export interface ClearMessagesMessage {
  type: 'clearMessages';
}

/**
 * Notify webview that conversation history was compacted/compressed.
 */
export interface MessagesCompressedMessage {
  type: 'messagesCompressed';
  remainingMessages: Message[];
  droppedCount: number;
  summaryInserted: boolean;
  source: 'budget' | 'overflow_rescue';
}

/**
 * Generic error message
 */
export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
  action?: 'retry' | 'switch_model' | 'new_chat' | 'check_privacy_settings' | 'none';
}

/**
 * Information message
 */
export interface InfoMessage {
  type: 'info';
  message: string;
}

export type ResilienceStatusCode =
  | 'CTX_BUDGET_UNSAFE'
  | 'CTX_RECOVERY_EXHAUSTED'
  | 'EMPTY_RESPONSE_DETECTED'
  | 'EMPTY_RESPONSE_RETRY_EXHAUSTED'
  | 'RATE_LIMIT_RETRY'
  | 'RATE_LIMIT_RETRY_EXHAUSTED'
  | 'SEQUENCE_REPAIR_RETRY'
  | 'SEQUENCE_REPAIR_EXHAUSTED'
  | 'GUARDRAIL_PRIVACY_BLOCK'
  | 'REQUEST_STOPPED';

export type ResilienceStatusCategory =
  | 'context'
  | 'empty_response'
  | 'rate_limit'
  | 'sequence'
  | 'guardrail'
  | 'request';

export type ResilienceStatusSeverity = 'info' | 'warning' | 'error';

export type ResilienceStatusAction =
  | 'retry'
  | 'switch_model'
  | 'new_chat'
  | 'check_privacy_settings'
  | 'none';

export type ResilienceStatusPhase =
  | 'preflight'
  | 'runtime'
  | 'retry'
  | 'terminal'
  | 'stopped';

export type ResilienceStatusDecision =
  | 'retry'
  | 'recover'
  | 'abort'
  | 'ignore'
  | 'report';

/**
 * Structured resilience/retry status for deterministic UI and telemetry handling.
 */
export interface ResilienceStatusMessage {
  type: 'resilienceStatus';
  code: ResilienceStatusCode;
  category: ResilienceStatusCategory;
  severity: ResilienceStatusSeverity;
  retryable: boolean;
  attempt: number;
  maxAttempts: number;
  nextDelayMs?: number;
  model: string;
  flowId: string | null;
  userMessage: string;
  action: ResilienceStatusAction;
  phase: ResilienceStatusPhase;
  decision: ResilienceStatusDecision;
  reason: string;
  correlationId: string;
}

/**
 * File reference added
 */
export interface AddFileReferenceMessage {
  type: 'addFileReference';
  fileReference: FileReference;
}

/**
 * File search results
 */
export interface FileSearchResultsMessage {
  type: 'fileSearchResults';
  results: Array<{
    path: string;
    name: string;
    score?: number;
  }>;
}

/**
 * File preview content
 */
export interface FilePreviewContentMessage {
  type: 'filePreviewContent';
  path: string;
  content: string;
}

/**
 * Context files updated
 */
export interface ContextUpdateMessage {
  type: 'contextUpdate';
  files: Array<{
    path: string;
    pinned: boolean;
  }>;
  stats: {
    totalFiles: number;
    pinnedFiles: number;
  };
}

/**
 * Validation metrics data
 */
export interface ValidationMetricsMessage {
  type: 'validationMetrics';
  metrics: Record<string, unknown>;
}

/**
 * Prompt enhancement in progress
 */
export interface PromptEnhancingMessage {
  type: 'promptEnhancing';
  isEnhancing: boolean;
}

/**
 * Prompt enhanced successfully
 */
export interface PromptEnhancedMessage {
  type: 'promptEnhanced';
  originalPrompt: string;
  enhancedPrompt: string;
  improvements: string[];
  tokensUsed: number;
}

/**
 * Prompt enhancement failed
 */
export interface PromptEnhanceErrorMessage {
  type: 'promptEnhanceError';
  error: string;
}

/**
 * System reset completed
 */
export interface SystemResetMessage {
  type: 'systemReset';
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * System diagnostics results
 */
export interface SystemDiagnosticsMessage {
  type: 'systemDiagnostics';
  diagnostics: Record<string, unknown>;
  error?: string;
}

/**
 * System config updated
 */
export interface SystemConfigUpdatedMessage {
  type: 'systemConfigUpdated';
  success: boolean;
  config?: Record<string, unknown>;
  error?: string;
}

/**
 * System message to display
 */
export interface SystemMessageMessage {
  type: 'systemMessage';
  messageId?: string;
  content: string;
}

/**
 * Assistant response message
 */
export interface AssistantMessageMessage {
  type: 'assistantMessage';
  id: string;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  checkpoint?: Checkpoint;
  isStreaming?: boolean;
}

/**
 * User message confirmation
 */
export interface UserMessageMessage {
  type: 'userMessage';
  id: string;
  content: string;
  timestamp: number;
  fileReferences?: FileReference[];
}

/**
 * Assistant message complete
 */
export interface AssistantMessageEndMessage {
  type: 'assistantMessageEnd';
  messageId: string;
}

/**
 * User message complete
 */
export interface UserMessageEndMessage {
  type: 'userMessageEnd';
  messageId: string;
}

/**
 * Message saved confirmation
 */
export interface MessageSavedMessage {
  type: 'messageSaved';
  messageId: string;
  role: string;
}

/**
 * Checkpoint successfully restored
 */
export interface CheckpointRestoredMessage {
  type: 'checkpointRestored';
  checkpointId: string;
  messageId: string;
  checkpointNumber: number;
  filesRestored: string[];
  mode?: 'files' | 'task' | 'files&task';
  messagesPruned?: number;
}

export interface CheckpointRestorePlannedMessage {
  type: 'checkpointRestorePlanned';
  checkpointId: string;
  messageId: string;
  mode: 'files' | 'task' | 'files&task';
}

/**
 * List of checkpoints for a message
 */
export interface CheckpointsMessage {
  type: 'checkpoints';
  messageId: string;
  checkpoints: Array<{
    id: string;
    checkpointNumber: number;
    description: string;
    timestamp: number;
    commitHash?: string;
    filesChanged?: number;
  }>;
}

export interface CheckpointDiffReadyMessage {
  type: 'checkpointDiffReady';
  fromCheckpointId: string;
  toCheckpointId?: string;
  files: Array<{
    relativePath: string;
    absolutePath: string;
    status: 'A' | 'M' | 'D' | 'R';
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      content: string;
    }>;
    beforeContent?: string;
    afterContent?: string;
  }>;
}

/**
 * Checkpoint restore failed
 */
export interface CheckpointRestoreErrorMessage {
  type: 'checkpointRestoreError';
  checkpointId: string;
  messageId: string;
  error: string;
}

/**
 * Mode was changed
 */
export interface ModeChangedResponseMessage {
  type: 'modeChanged';
  modeId: string;
  modeName: string;
  modeDescription: string;
  agentMode: boolean;
}

/**
 * Command was killed
 */
export interface CommandKilledMessage {
  type: 'commandKilled';
  commandId: string;
  success: boolean;
}

/**
 * Tool execution started
 */
export interface ToolExecutionStartMessage {
  type: 'toolExecutionStart';
  toolName: string;
  timestamp: number;
}

/**
 * Terminal output chunk
 */
export interface TerminalOutputChunkMessage {
  type: 'terminalOutputChunk';
  commandId: string;
  chunk: OutputChunk;
  timestamp: number;
}

/**
 * Approval needed for command
 */
export interface ApprovalRequestMessage {
  type: 'approvalRequest';
  request: ApprovalRequest;
  timestamp: number;
}

/**
 * Approval response
 */
export interface ApprovalResponseMessage {
  type: 'approvalResponse';
  commandId: string;
  response: 'accept' | 'accept_always' | 'deny';
  timestamp: number;
}

/**
 * Terminal mode changed
 */
export interface TerminalModeChangedMessage {
  type: 'terminalModeChanged';
  mode: TerminalMode;
  timestamp: number;
}

/**
 * Quick patterns list changed
 */
export interface QuickPatternsChangedMessage {
  type: 'quickPatternsChanged';
  patterns: QuickPattern[];
  timestamp: number;
}

/**
 * Terminal status update
 */
export interface TerminalStatusMessage {
  type: 'terminalStatus';
  activeCommands: string[];
  mode: TerminalMode;
  timestamp: number;
}

/**
 * Workspace information
 */
export interface WorkspaceInfoMessage {
  type: 'workspaceInfo';
  info: {
    name: string;
    path: string;
  };
}

/**
 * Response for current plan request
 */
export interface CurrentPlanResponseMessage {
  type: 'currentPlanResponse';
  plan: any | null;
}

/**
 * Memories data updated
 */
export interface MemoriesUpdateMessage {
  type: 'memoriesUpdate';
  memories: Array<Record<string, unknown>>;
  stats: Record<string, unknown>;
}

/**
 * Plan created in Architect Mode
 */
export interface PlanCreatedMessage {
  type: 'planCreated';
  plan: any; // Using any for large plan object for now
}

/**
 * Task execution started
 */
export interface TaskStartMessage {
  type: 'taskStart';
  taskId: string;
  taskName: string;
}

/**
 * Task execution update
 */
export interface TaskUpdateMessage {
  type: 'taskUpdate';
  taskId: string;
  status: string;
}

/**
 * Task execution complete
 */
export interface TaskCompleteMessage {
  type: 'taskComplete';
  taskId: string;
}

/**
 * Tool execution complete with comment
 */
export interface ToolCompleteMessage {
  type: 'toolComplete';
  tool: string;
  comment: string;
}

export interface WriteStartedMessage {
  type: 'write_started';
  path?: string;
  bytes?: number;
  timestamp: number;
}

export interface WriteFinishedMessage {
  type: 'write_finished';
  path?: string;
  bytes?: number;
  success: boolean;
  durationMs?: number;
  error?: string;
  timestamp: number;
}

/**
 * Plan step completed
 */
export interface PlanStepCompletedMessage {
  type: 'planStepCompleted';
  planId: string;
  stepId: string;
  result: any;
}

/**
 * Checkpoint created confirmation
 */
export interface CheckpointCreatedConfirmationMessage {
  type: 'checkpointCreated';
  messageId: string;
  checkpointId: string;
  checkpointNumber: number;
  filesTracked: number;
}

/**
 * Iterative plan completed
 */
export interface IterativePlanCompletedMessage {
  type: 'iterativePlanCompleted';
  goal: string;
  totalSteps: number;
  totalTime: number;
}

/**
 * Generation started
 */
export interface GeneratingStartMessage {
  type: 'generatingStart';
}

/**
 * Generation ended
 */
export interface GeneratingEndMessage {
  type: 'generatingEnd';
}

/**
 * Processing started
 */
export interface ProcessingStartMessage {
  type: 'processingStart';
}

/**
 * Processing ended
 */
export interface ProcessingEndMessage {
  type: 'processingEnd';
}

/**
 * Assistant message thinking update (Legacy/Legacy only?)
 */
export interface AssistantThinkingMessage {
  type: 'thinking';
  content: string;
}

/**
 * Token usage update (current context + session totals)
 */
export interface TokenTrackerUpdateMessage {
  type: 'tokenTrackerUpdate';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
    currentContextTokens?: number;
    modelContextLength?: number;
    compressionLevel?: 'none' | 'proactive' | 'aggressive';
    warnings?: string[];
    estimatedCostUsd: number | null;
    lastUpdated: number;
  };
  maxTokens: number;
  modelContextLength?: number;
  currentContextTokens?: number;
  sessionPromptTokens?: number;
  sessionCompletionTokens?: number;
  sessionTotalTokens?: number;
  compressionLevel?: 'none' | 'proactive' | 'aggressive';
  warnings?: string[];
  pricing: { prompt?: number; completion?: number; cache_read?: number; cache_write?: number } | null;
  cost: number | null;
}

/**
 * Plan status update (plan executing/completed/failed)
 */
export interface PlanStatusUpdateMessage {
  type: 'planStatusUpdate';
  planId: string;
  status: string;
  completedSteps?: number;
}

/**
 * Step status update (step pending/in-progress/completed/failed)
 */
export interface StepStatusUpdateMessage {
  type: 'stepStatusUpdate';
  planId: string;
  stepId: string;
  status: string;
  result?: unknown;
  error?: string;
}

/**
 * Full plan state update (sent after each step change for UI sync)
 */
export interface PlanUpdatedMessage {
  type: 'planUpdated';
  plan: any;
}

// =====================================================
// DISCRIMINATED UNIONS
// =====================================================

/**
 * All inbound messages (Webview → Extension)
 */
export type InboundWebviewMessage =
  | ReadyMessage
  | SendMessageMessage
  | ClearHistoryMessage
  | SetMaxTokensMessage
  | SetApiKeyMessage
  | DeleteApiKeyMessage
  | CheckApiKeyMessage
  | FetchModelsMessage
  | ToggleAgentModeMessage
  | ModelChangedMessage
  | SetModeMessage
  | RequestContextUpdateMessage
  | AddFilesToContextMessage
  | TogglePinFileMessage
  | StopMessageMessage
  | GetWorkspaceInfoMessage
  | OpenMemoriesMessage
  | OpenFileMessage
  | SearchFilesMessage
  | OpenFilePickerMessage
  | RequestFilePreviewMessage
  | RevertCheckpointMessage
  | GetCheckpointDiffMessage
  | GetCheckpointsMessage
  | SystemMessageCreatedMessage
  | CommandApprovalCreatedMessage
  | CommandApprovalUpdatedMessage
  | ToolExecutionCreatedMessage
  | ToolExecutionUpdatedMessage
  | GetSessionsMessage
  | NewSessionMessage
  | SwitchSessionMessage
  | SessionActionMessage
  | SearchSessionsMessage
  | RefreshSessionsMessage
  | CommandApprovalResponseMessage
  | KillCommandMessage
  | SetTerminalModeMessage
  | ToggleQuickPatternMessage
  | EnhancePromptMessage
  | GetValidationMetricsMessage
  | NavigateToFileMessage
  | AddMemoryMessage
  | DeleteMemoryMessage
  | SyncTasksMessage
  | SyncContextMessage
  | RequestCurrentPlanMessage
  | RetryStepMessage
  | SkipStepMessage
  | RequestSessionMetadataMessage
  | AbortPlanMessage
  | ShowStepResultMessage
  | SetAutoApproveSettingsMessage
  | ToggleYoloModeMessage
  | ToolApprovalResponseMessage
  | GetHistoryMessage
  | DeleteSessionMessage
  | LoadSessionMessage
  | GetTokenUsageMessage;

/**
 * All outbound messages (Extension → Webview)
 */
export type OutboundWebviewMessage =
  | ApiKeyStatusMessage
  | ActiveModelChangedMessage
  | RetryingWithReducedTokensMessage
  | RetryingRateLimitMessage
  | RetryStatusMessage
  | ModelsListMessage
  | SessionsUpdateMessage
  | LoadMessagesMessage
  | ClearMessagesMessage
  | MessagesCompressedMessage
  | ResilienceStatusMessage
  | ErrorMessage
  | InfoMessage
  | AddFileReferenceMessage
  | FileSearchResultsMessage
  | FilePreviewContentMessage
  | ContextUpdateMessage
  | ValidationMetricsMessage
  | PromptEnhancingMessage
  | PromptEnhancedMessage
  | PromptEnhanceErrorMessage
  | SystemResetMessage
  | SystemDiagnosticsMessage
  | SystemConfigUpdatedMessage
  | SystemMessageMessage
  | AssistantMessageMessage
  | UserMessageMessage
  | AssistantMessageEndMessage
  | UserMessageEndMessage
  | MessageSavedMessage
  | CheckpointRestoredMessage
  | CheckpointRestorePlannedMessage
  | CheckpointsMessage
  | CheckpointDiffReadyMessage
  | CheckpointRestoreErrorMessage
  | ModeChangedResponseMessage
  | CommandKilledMessage
  | ToolExecutionStartMessage
  | TerminalOutputChunkMessage
  | ApprovalRequestMessage
  | ApprovalResponseMessage
  | TerminalModeChangedMessage
  | QuickPatternsChangedMessage
  | TerminalStatusMessage
  | WorkspaceInfoMessage
  | MemoriesUpdateMessage
  | CurrentPlanResponseMessage
  | PlanCreatedMessage
  | TaskStartMessage
  | TaskUpdateMessage
  | TaskCompleteMessage
  | ToolCompleteMessage
  | WriteStartedMessage
  | WriteFinishedMessage
  | PlanStepCompletedMessage
  | CheckpointCreatedConfirmationMessage
  | IterativePlanCompletedMessage
  | GeneratingStartMessage
  | GeneratingEndMessage
  | ProcessingStartMessage
  | ProcessingEndMessage
  | AssistantThinkingMessage
  | { type: 'planLoaded'; plan: any; planId: string }
  | { type: 'checkpointRestored'; checkpointId: string; messageId: string; checkpointNumber: number; filesRestored: string[]; mode?: 'files' | 'task' | 'files&task'; messagesPruned?: number }
  | { type: 'checkpointRestorePlanned'; checkpointId: string; messageId: string; mode: 'files' | 'task' | 'files&task' }
  | { type: 'checkpoints'; messageId: string; checkpoints: any[] }
  | { type: 'checkpointDiffReady'; fromCheckpointId: string; toCheckpointId?: string; files: any[] }
  | { type: 'activityUpdate'; label: string | null }
  | AutoApproveSettingsUpdateMessage
  | ToolApprovalRequestMessage
  | PlanStatusUpdateMessage
  | StepStatusUpdateMessage
  | PlanUpdatedMessage
  | TokenTrackerUpdateMessage;

/**
 * Combined webview message type (bidirectional)
 */
export type WebviewMessage = InboundWebviewMessage | OutboundWebviewMessage;
