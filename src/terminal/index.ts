// =====================================================
// Terminal Modules Index - Central export for all terminal modules
// =====================================================

// Execution modules
export { ShellIntegrationExecutor as CommandExecutorImpl } from './ShellIntegrationExecutor';
export type { CommandExecutor, ExecutionOptions, CommandResult, OutputChunk, OutputChunkCallback } from './execution/types/ExecutionTypes';

// Approval modules
export { ApprovalManager as ApprovalManagerImpl } from '../approval/ApprovalManager';
export type {
  CommandEvaluation as SafetyEvaluation,
  TerminalMode,
  QuickPattern,
  SafetyLevel
} from '../types/approval';

// Communication modules
export { WebviewCommunicatorImpl } from './communication/WebviewCommunicator';
export type {
  WebviewCommunicator,
  WebviewMessage,
  WebviewMessageType,
  BaseWebviewMessage,
  ToolExecutionStartMessage,
  TerminalOutputChunkMessage,
  ApprovalRequestMessage,
  ApprovalResponseMessage,
  TerminalModeChangedMessage,
  QuickPatternsChangedMessage,
  TerminalStatusMessage
} from './communication/types/CommunicationTypes';

// Main terminal manager
export { TerminalManager } from './TerminalManager';