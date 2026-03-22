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
});
