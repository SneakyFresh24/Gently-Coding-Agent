// =====================================================
// Application Constants
// =====================================================

/**
 * Context Management
 */
export const CONTEXT_LIMITS = {
  DEFAULT_TOKEN_LIMIT: 128000, // DeepSeek V3.2 max
  MIN_TOKEN_LIMIT: 1000,
  MAX_TOKEN_LIMIT: 200000
} as const;

/**
 * Tool Execution
 */
export const TOOL_TIMEOUTS = {
  DEFAULT: 30000, // 30 seconds
  LONG_RUNNING: 300000, // 5 minutes
  QUICK: 5000 // 5 seconds
} as const;

/**
 * File Operations
 */
export const FILE_LIMITS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_PREVIEW_LINES: 100,
  MAX_SEARCH_RESULTS: 50
} as const;

/**
 * Memory Management
 */
export const MEMORY_LIMITS = {
  MAX_MEMORY_CONTENT_LENGTH: 10000,
  MAX_RELEVANT_MEMORIES: 20,
  MIN_CONFIDENCE_THRESHOLD: 0.5
} as const;

/**
 * Indexing
 */
export const INDEXING_LIMITS = {
  MAX_INDEXED_FILES: 10000,
  BATCH_SIZE: 100,
  DEBOUNCE_DELAY: 500 // ms
} as const;

/**
 * Terminal/Command Execution
 */
export const TERMINAL_LIMITS = {
  DEFAULT_TIMEOUT: 300, // seconds
  MAX_OUTPUT_LENGTH: 100000,
  COMMON_PORTS: [1420, 3000, 3001, 3002, 4173, 4200, 4321, 5000, 5173, 5174, 6006, 8000, 8080, 8081, 8787, 9000, 24678]
} as const;

/**
 * Development Server Detection Patterns
 */
export const DEV_SERVER_PATTERNS = [
  /npm create (?:vite@latest |react-app )?([^\s]+)/,
  /npx create-(?:react-app|next-app|vite) ([^\s]+)/,
  /cargo new ([^\s]+)/,
  /git clone .+ ([^\s]+)/,
  /mkdir ([^\s]+)/,
  /dotnet new ([^\s]+)/,
  /flutter create ([^\s]+)/,
  /rails new ([^\s]+)/,
  /django-admin startproject ([^\s]+)/
] as const;

/**
 * Validation
 */
export const VALIDATION_LIMITS = {
  MAX_RETRIES: 1,
  DEFAULT_TIMEOUT: 30000,
  MAX_ERRORS_PER_FILE: 20
} as const;

/**
 * Project Structure Analysis
 */
export const PROJECT_STRUCTURE = {
  MAX_DEPTH: 5,
  MAX_FILES_PER_DIRECTORY: 100,
  IGNORED_PATTERNS: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/.vscode/**',
    '**/.idea/**'
  ]
} as const;

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
  TOOL_NOT_FOUND: (toolName: string) => `Tool not found: ${toolName}`,
  MISSING_PARAMETER: (paramName: string) => `Missing required parameter: ${paramName}`,
  FILE_NOT_FOUND: (filePath: string) => `File not found: ${filePath}`,
  PERMISSION_DENIED: (action: string) => `Permission denied: ${action}`,
  TIMEOUT: (operation: string, timeout: number) => `${operation} timed out after ${timeout}ms`,
  INVALID_PARAMETER: (paramName: string, reason: string) => `Invalid parameter ${paramName}: ${reason}`,
  NETWORK_ERROR: 'Network error occurred',
  AUTHENTICATION_FAILED: 'Authentication failed',
  VALIDATION_FAILED: 'Validation failed'
} as const;

/**
 * Success Messages
 */
export const SUCCESS_MESSAGES = {
  FILE_CREATED: (filePath: string) => `File created: ${filePath}`,
  FILE_UPDATED: (filePath: string) => `File updated: ${filePath}`,
  FILE_DELETED: (filePath: string) => `File deleted: ${filePath}`,
  COMMAND_EXECUTED: (command: string) => `Command executed: ${command}`,
  MEMORY_ADDED: (content: string) => `Memory added: ${content}`,
  MEMORY_UPDATED: (memoryId: string) => `Memory updated: ${memoryId}`,
  CHECKPOINT_CREATED: (checkpointId: string) => `Checkpoint created: ${checkpointId}`,
  CHECKPOINT_RESTORED: (checkpointId: string) => `Checkpoint restored: ${checkpointId}`
} as const;

/**
 * Log Messages
 */
export const LOG_MESSAGES = {
  AGENT_INITIALIZED: 'Agent initialized successfully',
  AGENT_DISPOSED: 'Agent disposed',
  TOOL_EXECUTED: (toolName: string) => `Tool executed: ${toolName}`,
  FILE_ACCESSED: (filePath: string) => `File accessed: ${filePath}`,
  MEMORY_SEARCHED: (query: string) => `Memory searched: ${query}`,
  CONTEXT_UPDATED: 'Context updated',
  VALIDATION_COMPLETED: 'Validation completed',
  INDEXING_COMPLETED: 'Indexing completed',
  PROJECT_ANALYZED: 'Project analyzed'
} as const;

/**
 * Memory Categories
 */
export const MEMORY_CATEGORIES = {
  PREFERENCE: 'preference',
  CODEBASE: 'codebase',
  WORKFLOW: 'workflow',
  TECH_STACK: 'tech-stack',
  GENERAL: 'general'
} as const;

/**
 * File Language Mappings
 */
export const FILE_LANGUAGE_MAP: { [key: string]: string } = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.json': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.dockerfile': 'dockerfile',
  '.vue': 'vue',
  '.svelte': 'svelte'
};

/**
 * Tool Names
 */
export const TOOL_NAMES = {
  READ_FILE: 'read_file',
  WRITE_FILE: 'write_file',
  EDIT_FILE: 'edit_file',
  SAFE_EDIT_FILE: 'safe_edit_file',
  APPLY_BLOCK_EDIT: 'apply_block_edit',
  LIST_FILES: 'list_files',
  FIND_FILES: 'find_files',
  REGEX_SEARCH: 'regex_search',
  GET_CONTEXT: 'get_context',
  REMEMBER: 'remember',
  RECALL_MEMORIES: 'recall_memories',
  UPDATE_MEMORY: 'update_memory',
  DEPRECATE_MEMORY: 'deprecate_memory',
  CHECK_MEMORY_CONFLICTS: 'check_memory_conflicts',
  RECORD_CORRECTION: 'record_correction',
  CHECK_PATTERN_SUGGESTIONS: 'check_pattern_suggestions',
  ACCEPT_PATTERN_SUGGESTION: 'accept_pattern_suggestion',
  REJECT_PATTERN_SUGGESTION: 'reject_pattern_suggestion',
  CREATE_CHECKPOINT: 'create_checkpoint',
  RESTORE_CHECKPOINT: 'restore_checkpoint',
  RUN_COMMAND: 'run_command',
  CREATE_PLAN: 'create_plan',
  EXECUTE_PLAN: 'execute_plan'
} as const;

/**
 * Event Types
 */
export const EVENT_TYPES = {
  PLAN_CREATED: 'planCreated',
  PLAN_STATUS_UPDATE: 'planStatusUpdate',
  STEP_STATUS_UPDATE: 'stepStatusUpdate',
  TOOL_EXECUTION_START: 'toolExecutionStart',
  TOOL_EXECUTION_END: 'toolExecutionEnd',
  VALIDATION_START: 'validationStart',
  VALIDATION_END: 'validationEnd',
  MEMORY_ADDED: 'memoryAdded',
  MEMORY_UPDATED: 'memoryUpdated',
  MEMORY_DEPRECATED: 'memoryDeprecated',
  CHECKPOINT_CREATED: 'checkpointCreated',
  CHECKPOINT_RESTORED: 'checkpointRestored',
  CONTEXT_UPDATED: 'contextUpdated',
  INDEXING_STARTED: 'indexingStarted',
  INDEXING_COMPLETED: 'indexingCompleted'
} as const;
