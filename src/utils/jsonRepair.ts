/**
 * JSON Repair Utility
 * 
 * Attempts to repair common JSON errors from LLM-generated tool call arguments.
 * This is critical for handling DeepSeek V3.2's tendency to generate invalid JSON.
 */

export interface RepairResult {
  success: boolean;
  repaired?: any;
  originalError?: string;
  repairActions?: string[];
  finalError?: string;
  errorCode?: string;
  isTruncated?: boolean;
  truncationReason?: 'unterminated_string' | 'unbalanced_braces' | 'stream_ended_mid_json' | '';
  partialFields?: Record<string, unknown>;
  rawPreview?: string;
  charCount?: number;
}

/**
 * Attempt to repair and parse JSON
 */
export function repairAndParseJSON(jsonString: string, maxRepairAttempts: number = 3): RepairResult {
  const repairActions: string[] = [];
  let currentJson = jsonString;
  let originalErrorMsg = '';

  try {
    // Try parsing as-is first
    return { success: true, repaired: JSON.parse(currentJson), repairActions: [] };
  } catch (err: any) {
    originalErrorMsg = err.message;
    console.log('[JSONRepair] Original parse failed:', originalErrorMsg);
  }

  // Attempt repairs in a loop
  for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
    const jsonBeforeAttempt = currentJson;

    try {
      // Strategy 1: Fix missing quotes around keys (MUST BE FIRST to help state machines)
      const jsonAfterMissingQuotes = fixMissingQuotes(currentJson);
      if (jsonAfterMissingQuotes !== currentJson) {
        currentJson = jsonAfterMissingQuotes;
        if (!repairActions.includes('Added missing quotes around keys')) {
          repairActions.push('Added missing quotes around keys');
        }
      }

      // Strategy 2: Remove trailing commas
      const jsonAfterCommas = currentJson.replace(/,(\s*[}\]])/g, '$1');
      if (jsonAfterCommas !== currentJson) {
        currentJson = jsonAfterCommas;
        if (!repairActions.includes('Removed trailing commas')) {
          repairActions.push('Removed trailing commas');
        }
      }

      // Strategy 3: Fix unescaped newlines in strings
      const jsonAfterNewlines = fixUnescapedNewlines(currentJson);
      if (jsonAfterNewlines !== currentJson) {
        currentJson = jsonAfterNewlines;
        if (!repairActions.includes('Fixed unescaped newlines in strings')) {
          repairActions.push('Fixed unescaped newlines in strings');
        }
      }

      // Strategy 4: Fix unescaped quotes in strings
      const jsonAfterQuotes = fixUnescapedQuotes(currentJson);
      if (jsonAfterQuotes !== currentJson) {
        currentJson = jsonAfterQuotes;
        if (!repairActions.includes('Fixed unescaped quotes')) {
          repairActions.push('Fixed unescaped quotes');
        }
      }

      // Strategy 5: Remove control characters (except common whitespace)
      const jsonAfterControlChars = currentJson.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      if (jsonAfterControlChars !== currentJson) {
        currentJson = jsonAfterControlChars;
        if (!repairActions.includes('Removed control characters')) {
          repairActions.push('Removed control characters');
        }
      }

      // Try parsing repaired JSON
      const parsed = JSON.parse(currentJson);

      return {
        success: true,
        repaired: parsed,
        originalError: originalErrorMsg,
        repairActions
      };

    } catch (err: any) {
      if (attempt === maxRepairAttempts || currentJson === jsonBeforeAttempt) {
        const truncation = detectTruncation(currentJson);
        const partialFields = truncation.isTruncated ? extractPartialJsonFields(currentJson) : {};
        console.error('[JSONRepair] Repair failed after all attempts:', {
          originalError: originalErrorMsg,
          finalError: err.message,
          repairActions,
          jsonPreview: currentJson.substring(0, 200)
        });

        return {
          success: false,
          originalError: originalErrorMsg,
          repairActions,
          finalError: err.message,
          errorCode: truncation.isTruncated ? 'TOOL_ARGS_TRUNCATED' : 'JSON_PARSE_ERROR',
          isTruncated: truncation.isTruncated,
          truncationReason: truncation.reason,
          partialFields,
          rawPreview: currentJson.slice(0, 500),
          charCount: currentJson.length
        };
      }
    }
  }

  const truncation = detectTruncation(currentJson);
  const partialFields = truncation.isTruncated ? extractPartialJsonFields(currentJson) : {};

  return {
    success: false,
    originalError: originalErrorMsg,
    repairActions,
    finalError: 'Max repair attempts reached',
    errorCode: truncation.isTruncated ? 'TOOL_ARGS_TRUNCATED' : 'JSON_PARSE_ERROR',
    isTruncated: truncation.isTruncated,
    truncationReason: truncation.reason,
    partialFields,
    rawPreview: currentJson.slice(0, 500),
    charCount: currentJson.length
  };
}

export function detectTruncation(json: string): { isTruncated: boolean; reason: 'unterminated_string' | 'unbalanced_braces' | 'stream_ended_mid_json' | '' } {
  if (!json || json.trim() === '') {
    return { isTruncated: false, reason: '' };
  }

  let inString = false;
  let escape = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
    }
  }
  if (inString) {
    return { isTruncated: true, reason: 'unterminated_string' };
  }

  let braceBalance = 0;
  let bracketBalance = 0;
  inString = false;
  escape = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braceBalance += 1;
    if (ch === '}') braceBalance -= 1;
    if (ch === '[') bracketBalance += 1;
    if (ch === ']') bracketBalance -= 1;
  }

  if (braceBalance > 0 || bracketBalance > 0) {
    return { isTruncated: true, reason: 'unbalanced_braces' };
  }

  const trimmed = json.trim();
  const looksLikeJsonStart = trimmed.startsWith('{') || trimmed.startsWith('[');
  const noJsonEnd = !trimmed.endsWith('}') && !trimmed.endsWith(']');
  if (looksLikeJsonStart && noJsonEnd) {
    return { isTruncated: true, reason: 'stream_ended_mid_json' };
  }

  return { isTruncated: false, reason: '' };
}

export function extractPartialJsonFields(partialJson: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const PRIORITY_FIELDS = ['path', 'file_path', 'filePath', 'dir_path', 'directory'];

  for (const field of PRIORITY_FIELDS) {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`"${escapedField}"\\s*:\\s*"([^"]*)"`);
    const match = partialJson.match(regex);
    if (match) {
      result[field] = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }

  const pattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)(?:")?/g;

  for (const match of partialJson.matchAll(pattern)) {
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      continue;
    }
    const raw = match[2] || '';
    result[key] = raw
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return result;
}

/**
 * Fix unescaped newlines in JSON strings
 * This is the most common issue with LLM-generated JSON
 */
function fixUnescapedNewlines(json: string): string {
  // Strategy: Find string values and escape newlines within them
  // This is complex because we need to distinguish between:
  // 1. Actual newlines in string values (should be escaped)
  // 2. Newlines between JSON properties (should be kept)

  let result = '';
  let inString = false;
  let escapeNext = false;
  let stringStart = -1;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    const prevChar = i > 0 ? json[i - 1] : '';

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"' && prevChar !== '\\') {
      if (!inString) {
        // Starting a string
        inString = true;
        stringStart = i;
        result += char;
      } else {
        // Ending a string
        inString = false;
        result += char;
      }
      continue;
    }

    if (inString && (char === '\n' || char === '\r')) {
      // Escape newline in string
      if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Fix unescaped quotes in strings
 */
function fixUnescapedQuotes(json: string): string {
  // Strategy: Find quotes that are likely part of the string content rather than delimiters
  // A quote is likely content if it's NOT followed by: , } ] : or end of string (after optional whitespace)

  let result = '';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    const nextChars = json.substring(i + 1);

    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        // Starting a string
        inString = true;
        result += char;
      } else {
        // We are in a string. Is this the end of the string or an unescaped quote?
        // Heuristic: If it's the end, it's followed by , } ] : or whitespace then one of those
        const followedByDelimiter = /^\s*([,}\]:]|$)/.test(nextChars);

        if (followedByDelimiter) {
          // Likely the end of the string
          inString = false;
          result += char;
        } else {
          // Likely an unescaped quote inside the string
          result += '\\"';
        }
      }
      continue;
    }

    result += char;
  }

  return result;
}

/**
 * Fix missing quotes around object keys
 */
function fixMissingQuotes(json: string): string {
  // Replace unquoted keys like {key: "value"} with {"key": "value"}
  return json.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');
}

/**
 * Validate JSON against a simple schema
 */
export function validateJSONStructure(obj: any, requiredFields: string[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const field of requiredFields) {
    if (!(field in obj)) {
      missing.push(field);
    }
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

/**
 * Create a detailed error message for LLM retry
 */
export function createLLMErrorMessage(result: RepairResult, toolName: string): string {
  if (result.success) {
    return '';
  }

  let message = `Invalid JSON in tool call "${toolName}".\n\n`;
  message += `Original Error: ${result.originalError}\n`;

  if (result.repairActions && result.repairActions.length > 0) {
    message += `\nAttempted repairs:\n`;
    result.repairActions.forEach(action => {
      message += `  - ${action}\n`;
    });
  }

  if (result.finalError) {
    message += `\nFinal Error: ${result.finalError}\n`;
  }

  if (result.errorCode === 'TOOL_ARGS_TRUNCATED') {
    message += `\nDetected truncation: ${result.truncationReason || 'unknown'}.\n`;
    if (result.charCount) {
      message += `Observed length before truncation: ${result.charCount} chars.\n`;
    }
    message += `Split payload into smaller tool calls and retry.\n`;
  }

  message += `\n⚠️ Common JSON errors to avoid:\n`;
  message += `  1. Unescaped newlines in strings - use \\n instead of actual newlines\n`;
  message += `  2. Unescaped quotes in strings - use \\" for quotes inside strings\n`;
  message += `  3. Trailing commas - remove commas before } or ]\n`;
  message += `  4. Missing quotes around keys - all object keys must be quoted\n`;
  message += `\nPlease fix the JSON and retry the tool call.`;

  return message;
}
