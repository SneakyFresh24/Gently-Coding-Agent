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
});
