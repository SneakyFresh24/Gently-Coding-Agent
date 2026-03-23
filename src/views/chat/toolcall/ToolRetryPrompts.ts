interface TruncatedRetryPromptParams {
  toolName: string;
  recoveredPath?: string;
  contentPreview?: string;
  totalChars: number;
}

interface OversizeRetryPromptParams {
  toolName: string;
  actualSize: number;
  path?: string;
}

export function buildTruncatedRetryPrompt(params: TruncatedRetryPromptParams): string {
  const hasPath = Boolean(params.recoveredPath);
  const pathLine = hasPath ? params.recoveredPath! : 'unknown';
  const preview = (params.contentPreview || '').slice(0, 200).replace(/\r?\n/g, '\\n');
  return `
❌ Tool call "${params.toolName}" was truncated before completion.

This usually happens when the content is too large for a single tool call.

Solution: Split into multiple smaller calls:
- write_file(path, content) -> Multiple calls with ~30KB each
- Or use chunked safe_edit_file updates for incremental writes
${hasPath ? '' : '- IMPORTANT: Put "path" (or "file_path") as the FIRST JSON field before content'}

Recovered partial data:
- path: "${pathLine}"
- content preview: "${preview}..." (${params.totalChars} chars before truncation)
`.trim();
}

export function buildOversizeRetryPrompt(params: OversizeRetryPromptParams): string {
  const pathHint = params.path ? `"${params.path}"` : '<target_path>';
  return `
❌ Tool call "${params.toolName}" rejected: content exceeds 50KB limit.

Actual size: ${params.actualSize} characters
Maximum allowed: 50,000 characters

Solution: Split into multiple calls:
1. write_file(${pathHint}, "<first 30KB>")
2. safe_edit_file(${pathHint}, "<append next 30KB>")
3. Continue until complete
`.trim();
}
