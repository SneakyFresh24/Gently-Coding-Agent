import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ConversationPruner } from './ContextGenerators';
import { ChatViewContext, Message } from '../types/ChatTypes';

function msg(
    id: string,
    role: Message['role'],
    content: string,
    extra: Partial<Message> = {}
): Message {
    return {
        id,
        role,
        content,
        timestamp: Date.now(),
        ...extra
    };
}

function createContext(history: Message[]): ChatViewContext {
    return {
        agentMode: false,
        selectedModel: 'openai/gpt-4o-mini',
        selectedMode: 'ask',
        conversationHistory: history,
        shouldStopStream: false,
        messageCheckpoints: new Map(),
        toolExecutionStartSent: new Set()
    };
}

function createConfiguration(values: Record<string, unknown>) {
    return {
        get: <T>(key: string, fallback?: T): T => {
            if (Object.prototype.hasOwnProperty.call(values, key)) {
                return values[key] as T;
            }
            return fallback as T;
        }
    };
}

describe('ConversationPruner (Hybrid v2)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps first user + first assistant pair even when assistant has tool_calls', async () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
            createConfiguration({
                'pruning.strategy': 'hybrid',
                'pruning.maxHistoryLength': 6,
                'pruning.maxToolOutputChars': 500,
                'pruning.protectedTurns': 2
            }) as any
        );

        const pruner = new ConversationPruner({} as any, {} as any);
        const history: Message[] = [
            msg('sys-1', 'system', 'sys'),
            msg('u-1', 'user', 'initial request'),
            msg('a-1', 'assistant', 'architect response', { tool_calls: [{ id: 'call-1', result: 'ok' }] as any }),
            msg('t-1', 'tool', 'tool output'),
            msg('u-2', 'user', 'follow up 1'),
            msg('a-2', 'assistant', 'answer 2'),
            msg('u-3', 'user', 'follow up 2'),
            msg('a-3', 'assistant', 'answer 3')
        ];
        const context = createContext(history);

        await pruner.pruneConversationHistory(context);

        const keptIds = new Set(context.conversationHistory.map((entry) => entry.id));
        expect(keptIds.has('u-1')).toBe(true);
        expect(keptIds.has('a-1')).toBe(true);
    });

    it('applies priority truncate and appends stable marker', () => {
        const pruner = new ConversationPruner({} as any, {} as any);
        const toolContent = [
            'HEADER: file.ts',
            'line 2',
            'line 3',
            'operation failed due to issue',
            'Exception: stack details',
            'tail a',
            'tail b',
            'tail c'
        ].join('\n');
        const truncated = (pruner as any).truncateToolOutputWithMarker(toolContent, 120);
        expect(truncated.includes('[TRUNCATED')).toBe(true);
        expect(truncated.includes('→tool_output]')).toBe(true);
        expect(truncated.toLowerCase().includes('failed')).toBe(true);
    });

    it('does not prune tool outputs in the latest protected user turns', () => {
        const pruner = new ConversationPruner({} as any, {} as any);
        const longOldTool = 'old '.repeat(100);
        const longNewTool = 'new '.repeat(100);
        const history = [
            msg('u-1', 'user', 'first'),
            msg('a-1', 'assistant', 'a1'),
            msg('t-old', 'tool', longOldTool),
            msg('u-2', 'user', 'second'),
            msg('a-2', 'assistant', 'a2'),
            msg('u-3', 'user', 'third'),
            msg('a-3', 'assistant', 'a3'),
            msg('t-new', 'tool', longNewTool)
        ];
        const result = (pruner as any).pruneToolOutputs(history, {
            strategy: 'hybrid',
            maxHistoryLength: 7,
            maxToolOutputChars: 80,
            protectedTurns: 2
        });

        const oldTool = result.messages.find((entry: Message) => entry.id === 't-old');
        const newTool = result.messages.find((entry: Message) => entry.id === 't-new');
        expect(oldTool?.content.includes('→tool_output]')).toBe(true);
        expect(newTool?.content).toBe(longNewTool);
    });

    it('keeps system/pinned messages and avoids duplicate first-pair entries', async () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
            createConfiguration({
                'pruning.strategy': 'hybrid',
                'pruning.maxHistoryLength': 6,
                'pruning.maxToolOutputChars': 500,
                'pruning.protectedTurns': 2
            }) as any
        );

        const pruner = new ConversationPruner({} as any, {} as any);
        const context = createContext([
            msg('sys-1', 'system', 'system'),
            msg('u-1', 'user', 'initial'),
            msg('a-1', 'assistant', 'first answer'),
            msg('pin-1', 'assistant', 'must keep', { pinned: true }),
            msg('u-2', 'user', 'second'),
            msg('a-2', 'assistant', 'answer 2'),
            msg('u-3', 'user', 'third'),
            msg('a-3', 'assistant', 'answer 3')
        ]);

        await pruner.pruneConversationHistory(context);

        const ids = context.conversationHistory.map((entry) => entry.id);
        expect(ids.filter((id) => id === 'u-1')).toHaveLength(1);
        expect(ids.filter((id) => id === 'a-1')).toHaveLength(1);
        expect(ids.includes('sys-1')).toBe(true);
        expect(ids.includes('pin-1')).toBe(true);
    });

    it('defensively truncates assistant tool_calls[].result when present', () => {
        const pruner = new ConversationPruner({} as any, {} as any);
        const longResult = 'result '.repeat(80);
        const history = [
            msg('u-1', 'user', 'initial'),
            msg('a-1', 'assistant', 'assistant with call', {
                tool_calls: [{ id: 'call-1', result: longResult, function: { name: 'read_file', arguments: '{}' } }] as any
            }),
            msg('u-2', 'user', 'later'),
            msg('a-2', 'assistant', 'answer'),
            msg('u-3', 'user', 'latest'),
            msg('a-3', 'assistant', 'latest answer'),
            msg('x-1', 'assistant', 'overflow filler')
        ];
        const result = (pruner as any).pruneToolOutputs(history, {
            strategy: 'hybrid',
            maxHistoryLength: 6,
            maxToolOutputChars: 90,
            protectedTurns: 2
        });

        const assistantWithCall = result.messages.find((entry: Message) => entry.id === 'a-1');
        const callResult = (assistantWithCall?.tool_calls?.[0] as any)?.result || '';
        expect(callResult.includes('→tool_output]')).toBe(true);
    });

    it('uses legacy summarization path when configured', async () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
            createConfiguration({
                'pruning.strategy': 'legacy',
                'performance.legacyPruneCooldownMsgs': 20
            }) as any
        );

        const openRouterService = {
            async *streamChatMessage() {
                yield 'legacy-summary';
            }
        };
        const agentManager = {
            addMemory: vi.fn().mockResolvedValue(undefined)
        };
        const pruner = new ConversationPruner(openRouterService as any, agentManager as any);
        const context = createContext(
            Array.from({ length: 25 }, (_, index) =>
                msg(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
            )
        );

        await pruner.pruneConversationHistory(context);

        expect(context.conversationSummary).toContain('legacy-summary');
        expect(agentManager.addMemory).toHaveBeenCalled();
    });

    it('applies legacy cooldown and avoids repeated summary calls', async () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
            createConfiguration({
                'pruning.strategy': 'legacy',
                'performance.legacyPruneCooldownMsgs': 20
            }) as any
        );

        const streamChatMessage = vi.fn(async function* () {
            yield 'legacy-summary';
        });
        const openRouterService = { streamChatMessage };
        const agentManager = {
            addMemory: vi.fn().mockResolvedValue(undefined)
        };
        const pruner = new ConversationPruner(openRouterService as any, agentManager as any);
        const context = createContext(
            Array.from({ length: 25 }, (_, index) =>
                msg(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
            )
        );

        await pruner.pruneConversationHistory(context);
        const firstSummary = context.conversationSummary;
        await pruner.pruneConversationHistory(context);

        expect(streamChatMessage).toHaveBeenCalledTimes(1);
        expect(context.conversationSummary).toBe(firstSummary);
    });

    it('falls back to deterministic pruning when legacy summarization fails', async () => {
        vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue(
            createConfiguration({
                'pruning.strategy': 'legacy'
            }) as any
        );

        const openRouterService = {
            async *streamChatMessage() {
                throw new Error('stream-failure');
            }
        };
        const agentManager = {
            addMemory: vi.fn().mockResolvedValue(undefined)
        };
        const pruner = new ConversationPruner(openRouterService as any, agentManager as any);
        const context = createContext(
            Array.from({ length: 25 }, (_, index) =>
                msg(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `message ${index}`)
            )
        );

        const before = context.conversationHistory.length;
        await pruner.pruneConversationHistory(context);

        expect(context.conversationHistory.length).toBeLessThan(before);
    });
});
