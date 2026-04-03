interface TruncatedRetryPromptParams {
  toolName: string;
  recoveredPath?: string;
  contentPreview?: string;
  totalChars: number;
  retryCount?: number;
}

interface OversizeRetryPromptParams {
  toolName: string;
  actualSize: number;
  path?: string;
  retryCount?: number;
}

interface MonolithRetryPromptParams {
  toolName: string;
  path?: string;
  inlineViolations?: string[];
  suggestions?: string[];
  retryCount?: number;
}

type RetryErrorKind = 'truncated' | 'oversize' | 'monolith' | 'edit_failure' | 'read_failure' | 'unknown';

interface ProgressiveRetryPromptParams {
  toolName: string;
  retryCount: number;
  errorKind: RetryErrorKind;
  alternatives?: string[];
}

function getAlternatives(toolName: string, errorKind: RetryErrorKind): string[] {
  if (errorKind === 'edit_failure') {
    return [
      'Use apply_block_edit with smaller hunks',
      'Re-read target file before editing',
      'Use safe_edit_file only for a single simple change'
    ];
  }
  if (errorKind === 'read_failure') {
    return [
      'Verify path exists with list_files',
      'Use find_files to resolve the correct path',
      'Retry read_file only after confirming path'
    ];
  }
  if (errorKind === 'truncated' || errorKind === 'oversize') {
    return [
      'Split content into smaller chunks',
      'Keep each payload around 30KB',
      'Use write_file + incremental safe_edit_file/apply_block_edit'
    ];
  }
  if (errorKind === 'monolith') {
    return [
      'Split monolithic content into modular files',
      'Move inline CSS/JS to dedicated files',
      'Retry with smaller, focused edits'
    ];
  }
  return [
    `Use a different tool strategy for ${toolName}`,
    'Break task into smaller steps',
    'If blocked again, report issue to user'
  ];
}

export function buildProgressiveRetryPrompt(params: ProgressiveRetryPromptParams): string {
  const level = Math.max(1, Math.floor(params.retryCount || 1));
  const alternatives = (params.alternatives && params.alternatives.length > 0)
    ? params.alternatives
    : getAlternatives(params.toolName, params.errorKind);
  const alternativesText = alternatives.map((alt) => ` - ${alt}`).join('\n');

  if (level === 1) {
    return 'The previous tool call failed. Check your parameters and try again.';
  }
  if (level === 2) {
    return `This is your 2nd failed attempt. You MUST use a different approach:\n${alternativesText}`;
  }
  return `CRITICAL: 3+ failures. STOP retrying ${params.toolName}.\nYou MUST use:\n${alternativesText}\nIf this continues, report to user instead of retrying.`;
}

export function buildTruncatedRetryPrompt(params: TruncatedRetryPromptParams): string {
  const hasPath = Boolean(params.recoveredPath);
  const pathLine = hasPath ? params.recoveredPath! : 'unknown';
  const preview = (params.contentPreview || '').slice(0, 200).replace(/\r?\n/g, '\\n');
  const progressive = buildProgressiveRetryPrompt({
    toolName: params.toolName,
    retryCount: params.retryCount || 1,
    errorKind: 'truncated'
  });

  return `
❌ Tool call "${params.toolName}" was truncated before completion.

This usually happens when the content is too large for a single tool call.

${progressive}

Solution: Split into multiple smaller calls:
- write_file(path, content) -> runtime auto-chunking will split large payloads
- Or use chunked safe_edit_file updates for incremental writes
${hasPath ? '' : '- IMPORTANT: Put "path" (or "file_path") as the FIRST JSON field before content'}

Recovered partial data:
- path: "${pathLine}"
- content preview: "${preview}..." (${params.totalChars} chars before truncation)
`.trim();
}

export function buildOversizeRetryPrompt(params: OversizeRetryPromptParams): string {
  const pathHint = params.path ? `"${params.path}"` : '<target_path>';
  const progressive = buildProgressiveRetryPrompt({
    toolName: params.toolName,
    retryCount: params.retryCount || 1,
    errorKind: 'oversize'
  });
  const isWriteFile = params.toolName === 'write_file';
  const titleLine = isWriteFile
    ? `❌ Tool call "${params.toolName}" exceeded direct payload handling for one attempt.`
    : `❌ Tool call "${params.toolName}" rejected: content exceeds 50KB limit.`;
  const limitLine = isWriteFile
    ? 'Payload exceeded current runtime limit for this attempt.'
    : 'Maximum allowed: 50,000 characters';
  const solutionLine = isWriteFile
    ? `Solution: Retry with write_file(${pathHint}, "<full content>"). Runtime auto-chunking will segment it.`
    : `Solution: Split into multiple calls:\n1. write_file(${pathHint}, "<first 30KB>")\n2. safe_edit_file(${pathHint}, "<append next 30KB>")\n3. Continue until complete`;
  return `
${titleLine}

Actual size: ${params.actualSize} characters
${limitLine}

${progressive}

${solutionLine}
`.trim();
}

export function buildMonolithRetryPrompt(params: MonolithRetryPromptParams): string {
  const target = params.path ? `"${params.path}"` : '<target_path>';
  const violations = (params.inlineViolations || []).join(', ') || 'inline blocks exceeded policy';
  const suggestions = params.suggestions && params.suggestions.length > 0
    ? params.suggestions.map((s) => `- ${s}`).join('\n')
    : '- Move inline CSS into styles/main.css\n- Move inline JavaScript into scripts/main.js';

  const progressive = buildProgressiveRetryPrompt({
    toolName: params.toolName,
    retryCount: params.retryCount || 1,
    errorKind: 'monolith'
  });

  return `
❌ Tool call "${params.toolName}" blocked by monolith policy.

Target: ${target}
Violation: ${violations}

${progressive}

Please split the content into modular files before retrying.
Suggested split:
${suggestions}
`.trim();
}
