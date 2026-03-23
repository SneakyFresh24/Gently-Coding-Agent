import { describe, it, expect } from 'vitest';
import { StreamingToolCallProcessor } from '../StreamingToolCallProcessor';

describe('StreamingToolCallProcessor', () => {
    it('should NOT yield tool_call_start if only Name is present', async () => {
        const processor = new StreamingToolCallProcessor();
        const deltas = [
            { index: 0, function: { name: 'read_' } }
        ];
        
        const chunks = [];
        for await (const chunk of processor.processToolCallDeltas(deltas)) {
            chunks.push(chunk);
        }
        
        // Should only have tool_call_partial, NO tool_call_start
        expect(chunks.some(c => c.type === 'tool_call_start')).toBe(false);
        expect(chunks.some(c => c.type === 'tool_call_partial')).toBe(true);
    });

    it('should NOT yield tool_call_start if only ID is present', async () => {
        const processor = new StreamingToolCallProcessor();
        const deltas = [
            { index: 0, id: 'call_1' }
        ];
        
        const chunks = [];
        for await (const chunk of processor.processToolCallDeltas(deltas)) {
            chunks.push(chunk);
        }
        
        expect(chunks.some(c => c.type === 'tool_call_start')).toBe(false);
    });

    it('should yield tool_call_start only when BOTH ID and Name are present', async () => {
        const processor = new StreamingToolCallProcessor();
        
        // 1. Partial Name arrives
        const deltas1 = [{ index: 0, function: { name: 'read_file' } }];
        const chunks1 = [];
        for await (const chunk of processor.processToolCallDeltas(deltas1)) chunks1.push(chunk);
        expect(chunks1.some(c => c.type === 'tool_call_start')).toBe(false);

        // 2. ID arrives
        const deltas2 = [{ index: 0, id: 'call_123' }];
        const chunks2 = [];
        for await (const chunk of processor.processToolCallDeltas(deltas2)) chunks2.push(chunk);
        
        expect(chunks2.some(c => c.type === 'tool_call_start')).toBe(true);
        const startChunk = chunks2.find(c => c.type === 'tool_call_start') as any;
        expect(startChunk.toolName).toBe('read_file');
        expect(startChunk.toolCallId).toBe('call_123');
    });

    it('should yield tool_call_start immediately if ID and Name arrive together', async () => {
        const processor = new StreamingToolCallProcessor();
        const deltas = [
            { index: 0, id: 'call_1', function: { name: 'ls', arguments: '' } }
        ];
        
        const chunks = [];
        for await (const chunk of processor.processToolCallDeltas(deltas)) {
            chunks.push(chunk);
        }
        
        expect(chunks.some(c => c.type === 'tool_call_start')).toBe(true);
    });

    it('should only yield tool_call_start ONCE', async () => {
        const processor = new StreamingToolCallProcessor();
        
        // Chunk 1: ID + Partial Name
        const deltas1 = [{ index: 0, id: 'call_1', function: { name: 'read_' } }];
        const chunks1 = [];
        for await (const chunk of processor.processToolCallDeltas(deltas1)) chunks1.push(chunk);
        expect(chunks1.filter(c => c.type === 'tool_call_start')).toHaveLength(1);

        // Chunk 2: Completion of Name
        const deltas2 = [{ index: 0, function: { name: 'file' } }];
        const chunks2 = [];
        for await (const chunk of processor.processToolCallDeltas(deltas2)) chunks2.push(chunk);
        
        // Should NOT yield start again
        expect(chunks2.some(c => c.type === 'tool_call_start')).toBe(false);
    });

    it('should return completed tool calls with their original indices', async () => {
        const processor = new StreamingToolCallProcessor();

        const deltas = [
            { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
            { index: 2, id: 'call_2', function: { name: 'list_files', arguments: '{"path":"src"}' } }
        ];

        for await (const _chunk of processor.processToolCallDeltas(deltas)) {
            // Consume generator output to mutate internal state.
        }

        const completed = processor.getCompletedToolCalls();
        expect(completed).toHaveLength(2);
        expect(completed[0].index).toBe(0);
        expect(completed[1].index).toBe(2);
        expect(completed[0].toolCall.id).toBe('call_1');
        expect(completed[1].toolCall.id).toBe('call_2');
    });

    it('should report incomplete tool calls when args are truncated', async () => {
        const processor = new StreamingToolCallProcessor();
        const deltas = [
            { index: 0, id: 'call_1', function: { name: 'write_file', arguments: '{"path":"a.ts","content":"hello' } }
        ];

        for await (const _chunk of processor.processToolCallDeltas(deltas)) {
            // consume
        }

        const result = processor.getStreamingToolCallResult();
        expect(result.completedToolCalls).toHaveLength(0);
        expect(result.incompleteToolCalls).toHaveLength(1);
        expect(result.incompleteToolCalls[0].name).toBe('write_file');
        expect(result.incompleteToolCalls[0].truncationReason).toBe('unterminated_string');
    });
});
