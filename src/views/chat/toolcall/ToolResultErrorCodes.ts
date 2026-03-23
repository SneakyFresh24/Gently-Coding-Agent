export const ToolResultErrorCodes = {
  JSON_PARSE_ERROR: 'JSON_PARSE_ERROR',
  TOOL_ARGS_TRUNCATED: 'TOOL_ARGS_TRUNCATED',
  TOOL_ARGS_TOO_LARGE: 'TOOL_ARGS_TOO_LARGE',
  TOOL_EXECUTION_ERROR: 'TOOL_EXECUTION_ERROR',
  TOOL_NOT_FOUND: 'TOOL_NOT_FOUND'
} as const;

export type ToolResultErrorCode = typeof ToolResultErrorCodes[keyof typeof ToolResultErrorCodes];
