export interface ToolFailureResult {
  success: false;
  message?: string;
  error?: string;
  code?: string;
  [key: string]: unknown;
}

export interface ToolSuccessResult {
  success?: true;
  [key: string]: unknown;
}

export type ToolExecutionResult = ToolFailureResult | ToolSuccessResult | unknown;

export function isToolFailureResult(result: unknown): result is ToolFailureResult {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return false;
  }
  const payload = result as Record<string, unknown>;
  return payload.success === false;
}

export function getToolFailureMessage(toolName: string, result: ToolFailureResult): string {
  if (typeof result.message === 'string' && result.message.trim().length > 0) {
    return result.message.trim();
  }
  if (typeof result.error === 'string' && result.error.trim().length > 0) {
    return result.error.trim();
  }
  return `${toolName} returned success=false`;
}
