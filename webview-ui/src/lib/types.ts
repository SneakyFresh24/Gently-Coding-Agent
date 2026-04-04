// =====================================================
// Webview Types – mirrors backend WebviewMessageTypes.ts
// =====================================================

// ── Data Models ──────────────────────────────────────

export interface FileReference {
  path: string;
  name: string;
  relativePath?: string;
  language?: string;
  content?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface Checkpoint {
  id: string;
  checkpointNumber: number;
  filesTracked: number;
  commitHash?: string;
}

export interface ToolExecution {
  toolName: string;
  isExecuting: boolean;
  startTime: number;
  endTime?: number;
  duration?: number;
  fileName?: string;
  diffStats?: { added: number; deleted: number };
}

export interface CommandApproval {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: 'safe' | 'moderate' | 'risky';
  status: 'pending' | 'approved' | 'rejected';
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  params: any;
  timestamp: number;
  timeoutMs?: number;
  expiresAt?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
  mode?: string;
}

export interface QuestionCardState {
  questionId: string;
  header?: string;
  question: string;
  options: QuestionOption[];
  multiple: boolean;
  timeoutMs: number;
  defaultOptionIndex: number;
  status: 'pending' | 'resolved';
  selectedOptionIndexes: number[];
  resolutionSource?: 'user' | 'timeout_default' | 'stopped';
}

export interface PlanCardStepState {
  id: string;
  description: string;
  status: string;
  dependencies?: string[];
}

export interface PlanCardState {
  planId: string;
  goal: string;
  status: string;
  schemaVersion?: number;
  createdAt?: number;
  updatedAt?: number;
  steps: PlanCardStepState[];
  completedSteps: number;
  totalSteps: number;
  awaitingApproval?: boolean;
  pendingApproval?: {
    approvalRequestId: string;
    requestedAt?: number;
    timeoutMs?: number;
    expiresAt?: number;
  } | null;
}

export interface ToolApprovalCardState {
  approvalId: string;
  toolName: string;
  params: any;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string | null;
  source?: 'user' | 'system';
  createdAt: number;
  timeoutMs?: number;
  expiresAt?: number;
  resolvedAt?: number;
}

export interface ToolCallInfo {
  toolId: string;
  toolName: string;
  file?: string;
  status: 'running' | 'complete' | 'error';
  startedAt: number;
}


export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'command-approval' | 'tool-execution';
  content: string;
  toolName?: string;
  fileReferences?: FileReference[];
  toolCalls?: ToolCall[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  checkpoint?: Checkpoint;
  timestamp: number;
  isStreaming?: boolean;
  isSystemMessage?: boolean;
  commandApproval?: CommandApproval;
  toolExecution?: ToolExecution;
  questionCard?: QuestionCardState;
  planCard?: PlanCardState;
  approvalCard?: ToolApprovalCardState;
  diagnostic?: {
    code?: string;
    severity?: 'info' | 'warning' | 'error';
    correlationId?: string;
  };
}

// ── Extension State ──────────────────────────────────

export interface ApiConfiguration {
  provider: string;
  apiKey: string;
  baseUrl?: string;
  modelId: string;
}

export interface Task {
  id: string;
  text: string;
  ts: number;
}

export interface TaskHistoryItem {
  id: string;
  task: string;
  ts: number;
  size: number;
}

export interface AutoApprovalActions {
  readFiles: boolean;
  readFilesExternally: boolean;
  editFiles: boolean;
  editFilesExternally: boolean;
  executeSafeCommands: boolean;
  executeAllCommands: boolean;
  useBrowser: boolean;
  useMcp: boolean;
}

export interface AutoApprovalSettings {
  version: number; // Race condition prevention
  actions: AutoApprovalActions;
  enableNotifications: boolean;
  yoloMode: boolean;
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApprovalSettings = {
  version: 0,
  actions: {
    readFiles: false,
    readFilesExternally: false,
    editFiles: false,
    editFilesExternally: false,
    executeSafeCommands: false,
    executeAllCommands: false,
    useBrowser: false,
    useMcp: false,
  },
  enableNotifications: true,
  yoloMode: false,
};

export interface ExtensionState {
  apiConfiguration: ApiConfiguration | null;
  selectedModel: string;
  taskHistory: TaskHistoryItem[];
  currentTask: Task | null;
  messages: Message[];
  autoApprovalSettings: AutoApprovalSettings;
  mode: 'architect' | 'code' | 'ask' | 'agent' | 'debug';
  isStreaming: boolean;
  isProcessing: boolean;
  approvalOverlayFallbackEnabled?: boolean;
  activityLabel?: string | null;
  activityPhase?: 'idle' | 'sending' | 'thinking' | 'tooling';
  activeToolCalls?: ToolCallInfo[];
}

// ── Model Info ───────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
  max_output: number;
  pricing?: {
    prompt?: number;
    completion?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

// ── Inbound Messages (Webview → Extension) ───────────

export type InboundMessageType =
  | 'ready'
  | 'sendMessage'
  | 'clearHistory'
  | 'setApiKey'
  | 'deleteApiKey'
  | 'checkApiKey'
  | 'fetchModels'
  | 'toggleAgentMode'
  | 'modelChanged'
  | 'setMode'
  | 'setMaxTokens'
  | 'requestContextUpdate'
  | 'addFilesToContext'
  | 'togglePinFile'
  | 'stopMessage'
  | 'getWorkspaceInfo'
  | 'openMemories'
  | 'openFile'
  | 'searchFiles'
  | 'openFilePicker'
  | 'requestFilePreview'
  | 'revertCheckpoint'
  | 'getCheckpointDiff'
  | 'getCheckpoints'
  | 'systemMessageCreated'
  | 'commandApprovalCreated'
  | 'commandApprovalUpdated'
  | 'toolExecutionCreated'
  | 'toolExecutionUpdated'
  | 'getSessions'
  | 'newSession'
  | 'switchSession'
  | 'sessionAction'
  | 'searchSessions'
  | 'refreshSessions'
  | 'commandApprovalResponse'
  | 'killCommand'
  | 'setTerminalMode'
  | 'toggleQuickPattern'
  | 'enhancePrompt'
  | 'getValidationMetrics'
  | 'setAutoApproveSettings'
  | 'toggleYoloMode'
  | 'toolApprovalResponse'
  | 'webviewUnhandledMessage'
  | 'planApprovalResponse'
  | 'questionResponse'
  | 'syncTasks'
  | 'syncContext'
  | 'requestCurrentPlan'
  | 'retryStep'
  | 'skipStep'
  | 'requestSessionMetadata'
  | 'abortPlan'
  | 'showStepResult';

export interface InboundMessage {
  type: InboundMessageType;
  [key: string]: any;
}

// ── Outbound Messages (Extension → Webview) ──────────

export type OutboundMessageType =
  | 'apiKeyStatus'
  | 'modelsList'
  | 'modelChanged'
  | 'queryRuntimeEvent'
  | 'resilienceStatus'
  | 'subagentStatus'
  | 'error'
  | 'info'
  | 'modeChanged'
  | 'assistantMessage'
  | 'userMessage'
  | 'assistantMessageEnd'
  | 'userMessageEnd'
  | 'systemMessage'
  | 'loadMessages'
  | 'clearMessages'
  | 'messagesCompressed'
  | 'sessionsUpdate'
  | 'contextUpdate'
  | 'checkpointRestored'
  | 'checkpointRestorePlanned'
  | 'checkpointRestoreError'
  | 'checkpoints'
  | 'checkpointDiffReady'
  | 'toolExecutionStart'
  | 'commandKilled'
  | 'approvalRequest'
  | 'approvalResponse'
  | 'generatingStart'
  | 'generatingEnd'
  | 'processingStart'
  | 'processingEnd'
  | 'planUpdated'
  | 'planLoaded'
  | 'planStatusUpdate'
  | 'stepStatusUpdate'
  | 'planStepCompleted'
  | 'autoApproveSettingsUpdate'
  | 'toolApprovalRequest'
  | 'toolApprovalResolved'
  | 'questionRequest'
  | 'questionResolved'
  | 'planApprovalRequested'
  | 'planApprovalResolved'
  | 'planCardCreated'
  | 'planCardUpdated'
  | 'handoverProgress'
  | 'restoreSessionState'
  | 'setPromptFromGuardian'
  | 'workspaceInfo'
  | 'currentPlanResponse'
  | 'memoriesUpdate'
  | 'activityUpdate'
  | 'checkpointCreated'
  | 'iterativePlanCompleted'
  | 'taskStart'
  | 'taskUpdate'
  | 'taskComplete'
  | 'taskProgress'
  | 'toolComplete'
  | 'tokenTrackerUpdate'

  | 'messageSaved'
  | 'addFileReference'
  | 'fileSearchResults'
  | 'filePreviewContent'
  | 'validationMetrics'
  | 'promptEnhancing'
  | 'promptEnhanced'
  | 'promptEnhanceError'
  | 'terminalOutputChunk'
  | 'terminalModeChanged'
  | 'quickPatternsChanged'
  | 'terminalStatus'
  | 'refreshSessions'
  | 'thinking';


export interface OutboundMessage {
  type: OutboundMessageType;
  [key: string]: any;
}
