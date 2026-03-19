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
}

// ── Model Info ───────────────────────────────────────

export interface ModelInfo {
  id: string;
  name: string;
  context_length: number;
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
  | 'modeChanged'
  | 'setMode'
  | 'setMaxTokens'
  | 'requestContextUpdate'
  | 'addFilesToContext'
  | 'togglePinFile'
  | 'stopMessage'
  | 'getWorkspaceInfo'
  | 'getIndexingStats'
  | 'refreshIndexing'
  | 'addSourceFolder'
  | 'openMemories'
  | 'openFile'
  | 'searchFiles'
  | 'openFilePicker'
  | 'requestFilePreview'
  | 'revertCheckpoint'
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
  | 'sessionsUpdate'
  | 'contextUpdate'
  | 'checkpointRestored'
  | 'checkpointRestoreError'
  | 'checkpoints'
  | 'toolExecutionStart'
  | 'commandKilled'
  | 'approvalRequest'
  | 'approvalResponse'
  | 'generatingStart'
  | 'generatingEnd'
  | 'processingStart'
  | 'processingEnd'
  | 'planCreated'
  | 'planUpdated'
  | 'planLoaded'
  | 'planStatusUpdate'
  | 'stepStatusUpdate'
  | 'planStepCompleted'
  | 'autoApproveSettingsUpdate'
  | 'toolApprovalRequest'
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
  | 'toolComplete'
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
  | 'thinking';

export interface OutboundMessage {
  type: OutboundMessageType;
  [key: string]: any;
}
