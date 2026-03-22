import { describe, expect, it } from 'vitest';
import { TokenBudgetManager } from './TokenBudgetManager';
import { ChatMessage } from '../../../services/OpenRouterService';

describe('TokenBudgetManager', () => {
    it('keeps system prompt and trims older history first', () => {
        const manager = new TokenBudgetManager();
        const messages: ChatMessage[] = [
            { role: 'system', content: 'System prompt with summary.' },
            { role: 'user', content: 'old message '.repeat(200) },
            { role: 'assistant', content: 'old response '.repeat(200) },
            { role: 'user', content: 'latest user question' }
        ];

        const result = manager.compressMessagesForBudget('openai/gpt-4o-mini', messages, undefined, 250);

        expect(result.messages[0].role).toBe('system');
        expect(result.messages.some((m) => m.content.includes('latest user question'))).toBe(true);
        expect(result.wasCompressed).toBe(true);
        expect(result.droppedMessages).toBeGreaterThan(0);
        manager.dispose();
    });

    it('returns unchanged messages when budget is sufficient', () => {
        const manager = new TokenBudgetManager();
        const messages: ChatMessage[] = [
            { role: 'system', content: 'System prompt.' },
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'world' }
        ];

        const result = manager.compressMessagesForBudget('openai/gpt-4o-mini', messages, undefined, 4000);

        expect(result.messages).toHaveLength(3);
        expect(result.wasCompressed).toBe(false);
        manager.dispose();
    });

    it('never drops pinned messages during compression', () => {
        const manager = new TokenBudgetManager();
        const messages: ChatMessage[] = [
            { role: 'system', content: 'System prompt.' },
            { role: 'user', content: 'older content '.repeat(120) },
            { role: 'assistant', content: 'must keep me', pinned: true },
            { role: 'user', content: 'latest content '.repeat(40) }
        ];

        const result = manager.compressMessagesForBudget('openai/gpt-4o-mini', messages, undefined, 220);

        expect(result.messages.some((message) => message.pinned && message.content.includes('must keep me'))).toBe(true);
        manager.dispose();
    });

    it('injects compression summary when many messages are dropped', () => {
        const manager = new TokenBudgetManager();
        const messages: ChatMessage[] = [
            { role: 'system', content: 'System prompt with summary.' },
            ...Array.from({ length: 10 }, (_, idx) => ({
                role: idx % 2 === 0 ? 'user' as const : 'assistant' as const,
                content: `message-${idx} `.repeat(80)
            }))
        ];

        const result = manager.compressMessagesForBudget('openai/gpt-4o-mini', messages, undefined, 650, { summaryThreshold: 3 });
        const summaryMessage = result.messages.find((message) => message._compressed === true);

        expect(result.droppedMessages).toBeGreaterThan(3);
        expect(result.summaryInserted).toBe(true);
        expect(summaryMessage).toBeTruthy();
        expect(summaryMessage?.role).toBe('system');
        manager.dispose();
    });
});
