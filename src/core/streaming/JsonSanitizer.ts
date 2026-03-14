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
 * Attempts to parse JSON and provides a safe result object.
 */
export function tryParseJson(json: string): { success: boolean; data?: any; error?: string } {
    try {
        const data = JSON.parse(json);
        return { success: true, data };
    } catch (e) {
        return { 
            success: false, 
            error: e instanceof Error ? e.message : String(e) 
        };
    }
}
