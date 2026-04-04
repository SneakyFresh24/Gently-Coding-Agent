import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatFlowManager, EmptyAssistantResponseError } from './ChatFlowManager';
import { ChatViewContext } from '../types/ChatTypes';
import { OpenRouterHttpError } from '../../../services/OpenRouterService';

let configOverrides: Record<string, unknown> = {};

vi.mock('vscode', () => ({
    workspace: {
        name: 'test-workspace',
        getConfiguration: vi.fn(() => ({
            get: (key: string, fallback: unknown) => (key in configOverrides ? configOverrides[key] : fallback)
        }))
    }
}));

function createContext(selectedModel: string = 'openai/gpt-4o-mini'): ChatViewContext {
    return {
        agentMode: false,
        selectedModel,
        selectedMode: 'code',
        conversationHistory: [
            {
                id: 'u1',
                role: 'user',
                content: 'Please help',
                timestamp: Date.now()
            }
        ],
        shouldStopStream: false,
        messageCheckpoints: new Map(),
        toolExecutionStartSent: new Set()
    };
}

function createManager(overrides: {
    streamResponse?: any;
    contextLength?: number;
    maxTokens?: number;
    isContextLengthError?: (error: unknown) => boolean;
    isRateLimitError?: (error: unknown) => boolean;
    isGuardrailPrivacyError?: (error: unknown) => boolean;
} = {}) {
    const sendMessageToWebview = vi.fn();
    const streamingService = {
        streamResponse: overrides.streamResponse || vi.fn().mockResolvedValue({
            assistantMessage: 'ok',
            toolCalls: [],
            incompleteToolCalls: [],
            usage: undefined,
            streamTerminated: true
        })
    };
    const openRouterService = {
        getMaxTokens: vi.fn().mockResolvedValue(overrides.maxTokens ?? 8000),
        getContextLength: vi.fn().mockResolvedValue(overrides.contextLength ?? 32000),
        isRateLimitError: overrides.isRateLimitError || vi.fn().mockReturnValue(false),
        isGuardrailPrivacyError: overrides.isGuardrailPrivacyError || vi.fn().mockReturnValue(false),
        isToolCallSequenceError: vi.fn().mockReturnValue(false),
        isContextLengthError: overrides.isContextLengthError || vi.fn().mockReturnValue(false),
        getModelPricing: vi.fn().mockResolvedValue(null)
    };
    const toolCallManager = {
        repairConversationHistory: vi.fn((messages: any[]) => ({
            repaired: false,
            fixes: [],
            issuesBefore: [],
            issuesAfter: [],
            messages
        }))
    };

    const manager = new ChatFlowManager(
        { getFormattedTools: vi.fn().mockReturnValue([]) } as any,
        {
            saveMessageToHistory: vi.fn(),
            saveQueryRuntimeState: vi.fn().mockResolvedValue(undefined),
            appendQueryRuntimeBoundary: vi.fn().mockResolvedValue(undefined),
            getActiveSession: vi.fn().mockResolvedValue(null),
            getChatProvider: vi.fn().mockReturnValue(null)
        } as any,
        {} as any,
        { prepareSystemPrompt: vi.fn().mockResolvedValue('system prompt') } as any,
        streamingService as any,
        {} as any,
        toolCallManager as any,
        { handleToolCalls: vi.fn() } as any,
        { getTemperature: vi.fn().mockReturnValue(0.7), getCurrentMode: vi.fn().mockReturnValue(null) } as any,
        sendMessageToWebview,
        openRouterService as any
    );

    (manager as any).sleepWithStop = vi.fn().mockResolvedValue(undefined);

    return { manager, streamingService, openRouterService, sendMessageToWebview };
}

function expectQueryRuntimeStatus(sendMessageToWebview: ReturnType<typeof vi.fn>, status: Record<string, unknown>) {
    expect(sendMessageToWebview).toHaveBeenCalledWith(
        expect.objectContaining({
            type: 'queryRuntimeEvent',
            event: expect.objectContaining({
                type: 'status',
                ...status
            })
        })
    );
}

describe('ChatFlowManager resilience hardening', () => {
    beforeEach(() => {
        configOverrides = {
            'resilience.strictResponseGuards': true,
            'resilience.contextRecoveryV2': true
        };
    });

    it('computeMaxOutputTokens does not force a 256 token floor when budget is too small', () => {
        const { manager } = createManager();
        const result = (manager as any).computeMaxOutputTokens(3900, 4000, 8000, 8000);
        expect(result).toBe(0);
    });

    it('blocks request at preflight when output budget stays unsafe', async () => {
        const { manager, streamingService, sendMessageToWebview } = createManager({
            contextLength: 1100,
            maxTokens: 4000
        });

        await manager.generateAndStreamResponse(createContext(), 'test');

        expect(streamingService.streamResponse).not.toHaveBeenCalled();
        expect(sendMessageToWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                message: expect.stringContaining('Kontext-Budget')
            })
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'CTX_BUDGET_UNSAFE',
            category: 'context',
            retryable: false
        });
    });

    it('retries empty assistant responses and fails with explicit error after retry exhaustion', async () => {
        const empty = vi.fn().mockResolvedValue({
            assistantMessage: '',
            toolCalls: [],
            incompleteToolCalls: [],
            usage: undefined,
            streamTerminated: true
        });
        const { manager, streamingService, sendMessageToWebview } = createManager({
            streamResponse: empty,
            contextLength: 32000,
            maxTokens: 8000
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).rejects.toThrow(
            'No assistant message was received after retries.'
        );
        expect(streamingService.streamResponse).toHaveBeenCalledTimes(3);
        expect(sendMessageToWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                message: expect.stringContaining('No assistant message was received')
            })
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'EMPTY_RESPONSE_DETECTED',
            category: 'empty_response',
            retryable: true
        });
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'EMPTY_RESPONSE_RETRY_EXHAUSTED',
            category: 'empty_response',
            retryable: false,
            action: 'switch_model'
        });
    });

    it('does not treat a user-stopped stream as empty-response failure', async () => {
        const context = createContext();
        const stoppedStream = vi.fn().mockImplementation(async () => {
            context.shouldStopStream = true;
            return {
                assistantMessage: '',
                toolCalls: [],
                incompleteToolCalls: [],
                usage: undefined,
                streamTerminated: true
            };
        });
        const { manager, streamingService, sendMessageToWebview } = createManager({
            streamResponse: stoppedStream,
            contextLength: 32000,
            maxTokens: 8000
        });

        await expect(manager.generateAndStreamResponse(context, 'test')).resolves.toBeUndefined();
        expect(streamingService.streamResponse).toHaveBeenCalledTimes(1);
        expect(sendMessageToWebview).not.toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                message: expect.stringContaining('No assistant message was received')
            })
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'REQUEST_STOPPED',
            category: 'request',
            retryable: false
        });
    });

    it('resets stale tool-abort flag at the beginning of a new turn', async () => {
        const context = createContext();
        context.shouldAbortTools = true;
        const streamResponse = vi.fn().mockResolvedValue({
            assistantMessage: 'ok',
            toolCalls: [],
            incompleteToolCalls: [],
            usage: undefined,
            streamTerminated: true
        });
        const { manager } = createManager({
            streamResponse
        });

        await expect(manager.generateAndStreamResponse(context, 'test')).resolves.toBeUndefined();
        expect(context.shouldAbortTools).toBe(false);
        expect(streamResponse).toHaveBeenCalledTimes(1);
    });

    it('fails explicitly when stream ends without terminal stop event', async () => {
        const missingStop = vi.fn().mockResolvedValue({
            assistantMessage: 'partial response',
            toolCalls: [],
            incompleteToolCalls: [],
            usage: undefined,
            streamTerminated: false
        });
        const { manager, sendMessageToWebview } = createManager({
            streamResponse: missingStop
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).rejects.toThrow(
            'Assistant stream ended unexpectedly without a terminal stop event.'
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'STREAM_CONTRACT_MISSING_STOP',
            category: 'request',
            retryable: false,
            action: 'retry'
        });
        expect(sendMessageToWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                code: 'STREAM_CONTRACT_MISSING_STOP'
            })
        );
    });

    it('always enforces strict empty-response retries', async () => {
        configOverrides = {
            'resilience.strictResponseGuards': true,
            'resilience.contextRecoveryV2': true
        };
        const empty = vi.fn().mockResolvedValue({
            assistantMessage: '',
            toolCalls: [],
            incompleteToolCalls: [],
            usage: undefined,
            streamTerminated: true
        });
        const { manager, streamingService, sendMessageToWebview } = createManager({
            streamResponse: empty,
            contextLength: 32000,
            maxTokens: 8000
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).rejects.toThrow(
            'No assistant message was received after retries.'
        );
        expect(streamingService.streamResponse).toHaveBeenCalledTimes(3);
        expect(sendMessageToWebview).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'error',
                message: expect.stringContaining('No assistant message was received')
            })
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'EMPTY_RESPONSE_RETRY_EXHAUSTED'
        });
    });

    it('emits structured rate-limit retry status and succeeds on a later attempt', async () => {
        const rateLimitError = new OpenRouterHttpError({
            status: 429,
            message: 'rate limited',
            retryAfterMs: 100
        });
        const streamResponse = vi.fn()
            .mockRejectedValueOnce(rateLimitError)
            .mockResolvedValueOnce({
                assistantMessage: 'ok',
                toolCalls: [],
                incompleteToolCalls: [],
                usage: undefined,
                streamTerminated: true
            });
        const { manager, streamingService, sendMessageToWebview } = createManager({
            streamResponse,
            isRateLimitError: (error: unknown) => error instanceof OpenRouterHttpError && error.status === 429
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).resolves.toBeUndefined();
        expect(streamingService.streamResponse).toHaveBeenCalledTimes(2);
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'RATE_LIMIT_RETRY',
            category: 'rate_limit',
            retryable: true
        });
    });

    it('emits structured guardrail block status before failing', async () => {
        const guardrailError = new OpenRouterHttpError({
            status: 404,
            message: 'No endpoints available matching your guardrail restrictions data policy'
        });
        const streamResponse = vi.fn().mockRejectedValue(guardrailError);
        const { manager, sendMessageToWebview } = createManager({
            streamResponse,
            isGuardrailPrivacyError: (error: unknown) => error instanceof OpenRouterHttpError && error.status === 404
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).rejects.toThrow(
            'OpenRouter blocked this request due to privacy/guardrail settings.'
        );
        expectQueryRuntimeStatus(sendMessageToWebview, {
            code: 'GUARDRAIL_PRIVACY_BLOCK',
            category: 'guardrail',
            retryable: false,
            action: 'check_privacy_settings'
        });
    });

    it('bounds context recovery attempts and throws after deterministic recovery is exhausted', async () => {
        const ctxError = new OpenRouterHttpError({
            status: 400,
            message: 'Input token count exceeds model limit'
        });
        const failingStream = vi.fn().mockRejectedValue(ctxError);
        const { manager, streamingService } = createManager({
            streamResponse: failingStream,
            contextLength: 32000,
            maxTokens: 8000,
            isContextLengthError: (error: unknown) =>
                error instanceof OpenRouterHttpError && error.status === 400
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).rejects.toThrow(
            'Context window exceeded and automatic recovery was exhausted.'
        );
        expect(streamingService.streamResponse.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('uses recovery orchestrator for context overflow without legacy kill-switch fallback', async () => {
        configOverrides = {
            'resilience.strictResponseGuards': true,
            'resilience.contextRecoveryV2': true
        };
        const ctxError = new OpenRouterHttpError({
            status: 400,
            message: 'Input token count exceeds model limit'
        });
        const streamResponse = vi.fn()
            .mockRejectedValueOnce(ctxError)
            .mockResolvedValueOnce({
                assistantMessage: 'ok',
                toolCalls: [],
                incompleteToolCalls: [],
                usage: undefined,
                streamTerminated: true
            });
        const { manager, streamingService } = createManager({
            streamResponse,
            contextLength: 32000,
            maxTokens: 8000,
            isContextLengthError: (error: unknown) =>
                error instanceof OpenRouterHttpError && error.status === 400
        });

        await expect(manager.generateAndStreamResponse(createContext(), 'test')).resolves.toBeUndefined();
        expect(streamingService.streamResponse.mock.calls.length).toBeGreaterThanOrEqual(2);
        const firstCallOptions = streamingService.streamResponse.mock.calls[0][1];
        expect(firstCallOptions.maxTokens).toBe(8000);
        const lastCallOptions = streamingService.streamResponse.mock.calls[streamingService.streamResponse.mock.calls.length - 1][1];
        expect(lastCallOptions.maxTokens).toBeLessThanOrEqual(8000);
    });

    it('exposes empty-response error type for strict guard handling', () => {
        const err = new EmptyAssistantResponseError();
        expect(err.name).toBe('EmptyAssistantResponseError');
    });
});
