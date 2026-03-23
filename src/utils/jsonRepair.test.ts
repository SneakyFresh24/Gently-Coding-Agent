import { describe, it, expect } from 'vitest';
import { detectTruncation, extractPartialJsonFields, repairAndParseJSON } from './jsonRepair';

describe('jsonRepair', () => {
    describe('repairAndParseJSON', () => {
        it('should parse valid JSON as-is', () => {
            const json = '{"key": "value", "num": 123, "bool": true}';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired).toEqual({ key: 'value', num: 123, bool: true });
            expect(result.repairActions).toHaveLength(0);
        });

        it('should remove trailing commas in objects and arrays', () => {
            const json = '{"a": 1, "b": [1, 2, ], }';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired).toEqual({ a: 1, b: [1, 2] });
            expect(result.repairActions).toContain('Removed trailing commas');
        });

        it('should fix unescaped newlines in strings (DeepSeek style)', () => {
            const json = '{"reasoning": "This is a long\nreasoning with\r\nnewlines."}';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired.reasoning).toBe('This is a long\nreasoning with\r\nnewlines.');
            expect(result.repairActions).toContain('Fixed unescaped newlines in strings');
        });

        it('should fix unescaped quotes in strings', () => {
            const json = '{"text": "He said "Hello" to me"}';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired.text).toBe('He said "Hello" to me');
            expect(result.repairActions).toContain('Fixed unescaped quotes');
        });

        it('should fix missing quotes around keys', () => {
            const json = '{unquoted_key: "value", "quoted": 123}';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired.unquoted_key).toBe('value');
            expect(result.repairActions).toContain('Added missing quotes around keys');
        });

        it('should handle multiple errors in one JSON', () => {
            const json = '{ reasoning: "Line 1\nLine 2", info: "Nested "Quotes" here", }';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired.reasoning).toBe('Line 1\nLine 2');
            expect(result.repaired.info).toBe('Nested "Quotes" here');
            expect(result.repairActions).toContain('Added missing quotes around keys');
            expect(result.repairActions).toContain('Fixed unescaped newlines in strings');
            expect(result.repairActions).toContain('Fixed unescaped quotes');
        });

        it('should stop after maxRepairAttempts', () => {
            const json = 'totally { invalid } json';
            const result = repairAndParseJSON(json, 2);
            expect(result.success).toBe(false);
            expect(result.finalError).toBeDefined();
        });

        it('should handle complex unescaped quotes correctly', () => {
            const json = '{"cmd": "echo "Double "Quotes" Test"", "args": ["a", "b"]}';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(true);
            expect(result.repaired.cmd).toBe('echo "Double "Quotes" Test"');
        });

        it('should detect truncation for unterminated string payloads', () => {
            const json = '{"path":"src/a.ts","content":"hello world';
            const result = repairAndParseJSON(json);
            expect(result.success).toBe(false);
            expect(result.isTruncated).toBe(true);
            expect(result.truncationReason).toBe('unterminated_string');
            expect(result.errorCode).toBe('TOOL_ARGS_TRUNCATED');
        });

        it('should extract partial fields from truncated json', () => {
            const partial = '{"path":"src/a.ts","content":"line1\\nline2","mode":"w';
            const fields = extractPartialJsonFields(partial);
            expect(fields.path).toBe('src/a.ts');
            expect(fields.content).toBe('line1\nline2');
            expect(fields.mode).toBe('w');
        });

        it('should prioritize file_path style keys before generic extraction', () => {
            const partial = '{"file_path":"src/x.ts","new_content":"abc","directory":"src/utils","content":"zzz';
            const fields = extractPartialJsonFields(partial);
            expect(fields.file_path).toBe('src/x.ts');
            expect(fields.directory).toBe('src/utils');
            expect(fields.new_content).toBe('abc');
        });

        it('detectTruncation should report unbalanced braces', () => {
            const partial = '{"path":"src/a.ts","content":"abc"';
            const state = detectTruncation(partial);
            expect(state.isTruncated).toBe(true);
            expect(state.reason).toBe('unbalanced_braces');
        });
    });
});
