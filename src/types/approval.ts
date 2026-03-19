// =====================================================
// Approval and Terminal Types
// =====================================================

/**
 * Terminal operation mode
 */
export type TerminalMode = 'manual' | 'smart' | 'auto';

/**
 * Safety level for commands
 */
export type SafetyLevel = 'safe' | 'moderate' | 'risky' | 'unknown';

/**
 * Command quick patterns for auto-approval
 */
export interface QuickPattern {
  name: string;
  pattern: string;
  enabled: boolean;
}

/**
 * Request for command approval
 */
export interface ApprovalRequest {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: SafetyLevel;
  timestamp: number;
}

/**
 * Response for command approval
 */
export interface ApprovalResponse {
  commandId: string;
  response: 'accept' | 'accept_always' | 'deny';
}

/**
 * Auto-approval actions configuration
 */
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

/**
 * Auto-approval settings
 */
export interface AutoApprovalSettings {
  version: number;
  actions: AutoApprovalActions;
  enableNotifications: boolean;
}

/**
 * Command evaluation result
 */
export interface CommandEvaluation {
  safetyLevel: SafetyLevel;
  reason?: string;
}
