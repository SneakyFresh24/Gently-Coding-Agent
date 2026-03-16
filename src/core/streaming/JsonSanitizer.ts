/**
 * Utilities for cleaning and parsing JSON arguments from LLM outputs.
 */

/**
 * Escapes raw control characters (newlines, tabs, etc.) that might appear 
 * unescaped in LLM-generated JSON strings.
 */
export function sanitizeJsonArguments(args: string): string {
    if (!args) return '';

    // Replace raw control characters that are not allowed in JSON string literals
    // but often produced by LLMs (especially in multi-line strings or code blocks).
    return args
        .replace(/[\u0000-\u001F]/g, (match) => {
            switch (match) {
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                case '\b': return '\\b';
                case '\f': return '\\f';
                default: return '\\u' + match.charCodeAt(0).toString(16).padStart(4, '0');
            }
        });
}

/**
 * Attempts to repair truncated JSON by closing open strings, objects, and arrays.
 */
export function repairJson(json: string): string {
    if (!json) return '';
    let repaired = json.trim();

    // 1. Repair Unterminated Strings
    // If the last quote is not escaped and there's no closing quote
    let inString = false;
    for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '"' && (i === 0 || repaired[i-1] !== '\\')) {
            inString = !inString;
        }
    }
    if (inString) repaired += '"';

    // 2. Repair Missing Braces/Brackets
    const stack: string[] = [];
    inString = false;
    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (char === '"' && (i === 0 || repaired[i-1] !== '\\')) {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (char === '{' || char === '[') {
            stack.push(char);
        } else if (char === '}') {
            if (stack[stack.length - 1] === '{') stack.pop();
        } else if (char === ']') {
            if (stack[stack.length - 1] === '[') stack.pop();
        }
    }

    // Close remaining items in stack in reverse order
    while (stack.length > 0) {
        const last = stack.pop();
        if (last === '{') repaired += '}';
        if (last === '[') repaired += ']';
    }

    return repaired;
}

/**
 * Attempts to parse JSON and provides a safe result object.
 * Will attempt to repair if initial parse fails.
 */
export function tryParseJson(json: string): { success: boolean; data?: any; error?: string } {
    try {
        const data = JSON.parse(json);
        return { success: true, data };
    } catch (e) {
        try {
            const repaired = repairJson(json);
            const data = JSON.parse(repaired);
            return { success: true, data };
        } catch (repairError) {
            return { 
                success: false, 
                error: e instanceof Error ? e.message : String(e) 
            };
        }
    }
}
