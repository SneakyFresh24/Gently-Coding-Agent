/**
 * Auto-Approve Settings
 * Defines which tools and actions can be performed without explicit user confirmation.
 */

export interface AutoApproveSettings {
  // File operations
  readFiles: boolean;          // Read files within workspace
  readFilesExternally: boolean; // Read files outside workspace
  editFiles: boolean;          // Edit/Delete/Create files within workspace
  editFilesExternally: boolean; // Edit files outside workspace
  
  // Execution
  executeSafeCommands: boolean; // Auto-approve "safe" commands (formerly Smart Mode)
  executeAllCommands: boolean;  // Auto-approve ANY command (YOLO)
  
  // Advanced tools
  useBrowser: boolean;         // Auto-approve browser operations
  useMcp: boolean;             // Auto-approve MCP tool executions
  
  // Global toggles
  yoloMode: boolean;           // Shortcut to approve EVERYTHING (overrides others)
}

export const DEFAULT_AUTO_APPROVAL_SETTINGS: AutoApproveSettings = {
  readFiles: true,             // Reading project files is usually considered safe
  readFilesExternally: false,
  editFiles: false,
  editFilesExternally: false,
  executeSafeCommands: true,   // Default to "Smart Mode" behavior
  executeAllCommands: false,
  useBrowser: false,
  useMcp: false,
  yoloMode: false
};

export type AutoApproveCategory = keyof AutoApproveSettings;
