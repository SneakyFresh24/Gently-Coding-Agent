// =====================================================
// Webview Message Types - Complete type definitions for all webview communication
// =====================================================

import { FileReference } from '../../../agent/fileReferenceManager';
import { ToolCall } from '../../../services/OpenRouterService';
import { CommandApproval, ToolExecution, Checkpoint, Message } from './ChatTypes';
import {
  ApprovalRequest,
  TerminalMode,
  QuickPattern
} from '../../../terminal/HybridApprovalManager';
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
 * User login request
 */
export interface LoginMessage {
  type: 'login';
  email: string;
  password: string;
}

/**
 * User signup request
 */
export interface SignupMessage {
  type: 'signup';
  email: string;
  password: string;
  fullName?: string;
}

/**
 * User logout request
 */
export interface LogoutMessage {
  type: 'logout';
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
 * Chat mode changed
 */
export interface ModeChangedMessage {
  type: 'modeChanged';
  modeId: string;
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
 * Get indexing statistics
 */
export interface GetIndexingStatsMessage {
  type: 'getIndexingStats';
}

/**
 * Refresh code indexing
 */
export interface RefreshIndexingMessage {
  type: 'refreshIndexing';
}

/**
 * Add source folder to context
 */
export interface AddSourceFolderMessage {
  type: 'addSourceFolder';
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
 * Refresh Guardian analysis
 */
export interface RefreshGuardianMessage {
  type: 'refresh';
}

/**
 * Run workspace analysis
 */
export interface AnalyzeWorkspaceMessage {
  type: 'analyzeWorkspace';
}

/**
 * Open Guardian settings
 */
export interface OpenSettingsMessage {
  type: 'openSettings';
}

/**
 * Dismiss all Guardian issues
 */
export interface DismissAllIssuesMessage {
  type: 'dismissAllIssues';
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
 * Dismiss a single Guardian issue
 */
export interface DismissIssueMessage {
  type: 'dismissIssue';
  issueId: string;
}

/**
 * Fix a Guardian issue
 */
export interface FixIssueMessage {
  type: 'fixIssue';
  issueId: string;
  suggestionId: string;
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

// =====================================================
// OUTBOUND MESSAGES (Extension → Webview)
// =====================================================

/**
 * Login failed
 */
export interface LoginErrorMessage {
  type: 'loginError';
  message: string;
}

/**
 * Login successful
 */
export interface LoginSuccessMessage {
  type: 'loginSuccess';
}

/**
 * Signup failed
 */
export interface SignupErrorMessage {
  type: 'signupError';
  message: string;
}

/**
 * Signup successful
 */
export interface SignupSuccessMessage {
  type: 'signupSuccess';
  message: string;
}

/**
 * Logout successful
 */
export interface LogoutSuccessMessage {
  type: 'logoutSuccess';
  message: string;
}

/**
 * Logout failed
 */
export interface LogoutErrorMessage {
  type: 'logoutError';
  message: string;
}

/**
 * Current authentication status
 */
export interface AuthStatusMessage {
  type: 'authStatus';
  isAuthenticated: boolean;
  user?: { email: string } | null;
  agentMode?: boolean;
  selectedModel?: string;
  selectedMode?: string;
  currentMode?: Record<string, unknown>;
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
  models: { id: string; name: string; context_length: number }[];
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
 * Generic error message
 */
export interface ErrorMessage {
  type: 'error';
  message: string;
}

/**
 * Information message
 */
export interface InfoMessage {
  type: 'info';
  message: string;
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
 * Guardian data updated
 */
export interface UpdateDataMessage {
  type: 'updateData';
  issues: Array<Record<string, unknown>>;
  stats: Record<string, unknown>;
}

/**
 * Set prompt from Guardian suggestion
 */
export interface SetPromptFromGuardianMessage {
  type: 'setPromptFromGuardian';
  prompt: string;
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
  | LoginMessage
  | SignupMessage
  | LogoutMessage
  | SetMaxTokensMessage
  | SetApiKeyMessage
  | DeleteApiKeyMessage
  | CheckApiKeyMessage
  | FetchModelsMessage
  | ToggleAgentModeMessage
  | ModelChangedMessage
  | ModeChangedMessage
  | SetModeMessage
  | RequestContextUpdateMessage
  | AddFilesToContextMessage
  | TogglePinFileMessage
  | StopMessageMessage
  | GetWorkspaceInfoMessage
  | GetIndexingStatsMessage
  | RefreshIndexingMessage
  | AddSourceFolderMessage
  | OpenMemoriesMessage
  | OpenFileMessage
  | SearchFilesMessage
  | OpenFilePickerMessage
  | RequestFilePreviewMessage
  | RevertCheckpointMessage
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
  | RefreshGuardianMessage
  | AnalyzeWorkspaceMessage
  | OpenSettingsMessage
  | DismissAllIssuesMessage
  | NavigateToFileMessage
  | DismissIssueMessage
  | FixIssueMessage
  | AddMemoryMessage
  | DeleteMemoryMessage
  | SyncTasksMessage
  | SyncContextMessage
  | RequestCurrentPlanMessage
  | RetryStepMessage
  | SkipStepMessage
  | RequestSessionMetadataMessage
  | AbortPlanMessage
  | ShowStepResultMessage;

/**
 * All outbound messages (Extension → Webview)
 */
export type OutboundWebviewMessage =
  | LoginErrorMessage
  | LoginSuccessMessage
  | SignupErrorMessage
  | SignupSuccessMessage
  | LogoutSuccessMessage
  | LogoutErrorMessage
  | AuthStatusMessage
  | ApiKeyStatusMessage
  | ModelsListMessage
  | SessionsUpdateMessage
  | LoadMessagesMessage
  | ClearMessagesMessage
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
  | CheckpointsMessage
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
  | UpdateDataMessage
  | SetPromptFromGuardianMessage
  | WorkspaceInfoMessage
  | MemoriesUpdateMessage
  | CurrentPlanResponseMessage
  | PlanCreatedMessage
  | TaskStartMessage
  | TaskUpdateMessage
  | TaskCompleteMessage
  | ToolCompleteMessage
  | PlanStepCompletedMessage
  | CheckpointCreatedConfirmationMessage
  | IterativePlanCompletedMessage
  | GeneratingStartMessage
  | GeneratingEndMessage
  | ProcessingStartMessage
  | ProcessingEndMessage
  | AssistantThinkingMessage
  | { type: 'planLoaded'; plan: any; planId: string }
  | { type: 'checkpointRestored'; checkpointId: string; messageId: string; checkpointNumber: number; filesRestored: string[] }
  | { type: 'checkpoints'; messageId: string; checkpoints: any[] }
  | { type: 'activityUpdate'; label: string | null }
  | PlanStatusUpdateMessage
  | StepStatusUpdateMessage
  | PlanUpdatedMessage;

/**
 * Combined webview message type (bidirectional)
 */
export type WebviewMessage = InboundWebviewMessage | OutboundWebviewMessage;
