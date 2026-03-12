import { describe, it, expect, beforeEach } from 'vitest';
import { ChatMemoryOptimizer, ChatMessage, ChatSession } from './chatMemoryOptimizer';

describe('ChatMemoryOptimizer', () => {
    let optimizer: ChatMemoryOptimizer;

    beforeEach(() => {
        optimizer = new ChatMemoryOptimizer();
    });

    describe('limitMessageCount (Weighted)', () => {
        it('should keep messages with higher weights', async () => {
            const messages: ChatMessage[] = [
                { id: 'm1', role: 'user', content: 'Low weight', timestamp: Date.now() - 10000, weight: 1 },
                { id: 'm2', role: 'user', content: 'High weight', timestamp: Date.now() - 20000, weight: 10 },
                { id: 'm3', role: 'user', content: 'Medium weight', timestamp: Date.now() - 5000, weight: 5 },
            ];

            const session: ChatSession = {
                id: 's1',
                title: 'Test Session',
                messages: messages,
                lastActivity: Date.now()
            };

            // Limit to 2 messages, disable merging for test
            const result = await optimizer.optimizeSession(session, {
                maxMessages: 2,
                mergeConsecutiveMessages: false
            });

            const ids = result.messages.map(m => m.id);
            expect(ids).toContain('m2'); // Highest weight
            expect(ids).toContain('m3'); // Second highest weight
            expect(ids).not.toContain('m1');
        });

        it('should always keep system messages', async () => {
            const messages: ChatMessage[] = [
                { id: 'sys', role: 'system', content: 'Must stay', timestamp: Date.now() - 100000 },
                { id: 'm1', role: 'user', content: 'Old', timestamp: Date.now() - 50000 },
                { id: 'm2', role: 'user', content: 'New', timestamp: Date.now() - 1000 },
            ];

            const session: ChatSession = {
                id: 's1',
                title: 'Test Session',
                messages: messages,
                lastActivity: Date.now()
            };

            const result = await optimizer.optimizeSession(session, { maxMessages: 1 });

            expect(result.messages).toHaveLength(1);
            expect(result.messages[0].id).toBe('sys');
        });
    });
});
