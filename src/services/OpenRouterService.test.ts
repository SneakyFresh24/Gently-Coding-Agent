import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterService, OpenRouterHttpError } from './OpenRouterService';

describe('OpenRouterService.isToolCallSequenceError', () => {
  const service = new OpenRouterService({
    getKey: async () => 'test-key'
  } as any);

  it('detects known tool-call sequence provider error', () => {
    const error = new OpenRouterHttpError({
      status: 400,
      message: 'invalid params, tool call result does not follow tool call'
    });
    expect(service.isToolCallSequenceError(error)).toBe(true);
  });

  it('does not classify unrelated errors as sequence errors', () => {
    const error = new OpenRouterHttpError({
      status: 429,
      message: 'OpenRouter rate limit exceeded'
    });
    expect(service.isToolCallSequenceError(error)).toBe(false);
  });

  it('detects minimax-style invalid function arguments errors', () => {
    const error = new OpenRouterHttpError({
      status: 400,
      message: 'Invalid function arguments provided for tool call'
    });
    expect(service.isToolCallSequenceError(error)).toBe(true);
  });

  it('detects context-window-exceeds-limit as sequence issue pattern', () => {
    const error = new OpenRouterHttpError({
      status: 400,
      message: 'context window exceeds limit while resolving tool call'
    });
    expect(service.isToolCallSequenceError(error)).toBe(true);
  });
});

describe('OpenRouterService.isContextLengthError', () => {
  const service = new OpenRouterService({
    getKey: async () => 'test-key'
  } as any);

  it('detects expanded overflow pattern variants', () => {
    const error = new OpenRouterHttpError({
      status: 400,
      message: 'Input token count exceeds model limit'
    });
    expect(service.isContextLengthError(error)).toBe(true);
  });
});

describe('OpenRouterService model policy integration', () => {
  const service = new OpenRouterService({
    getKey: async () => 'test-key'
  } as any);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies sequence guard for devstral tool->user transitions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {},
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await service.sendChatMessage({
      model: 'mistral/devstral-small',
      stream: false,
      messages: [
        { role: 'tool', content: 'result', tool_call_id: 'abc' },
        { role: 'user', content: 'next step please' }
      ]
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.messages[1]).toEqual({ role: 'assistant', content: 'Done.' });
    expect(payload.messages[2].role).toBe('user');
  });

  it('sanitizes gemini tool schema enums and required fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {},
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await service.sendChatMessage({
      model: 'google/gemini-2.5-pro',
      stream: false,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'demo',
            description: 'demo',
            parameters: {
              type: 'object',
              properties: {
                score: { type: 'integer', enum: [1, 2] }
              },
              required: ['score', 'missing']
            }
          }
        }
      ]
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    const schema = payload.tools[0].function.parameters;
    expect(schema.properties.score.type).toBe('string');
    expect(schema.properties.score.enum).toEqual(['1', '2']);
    expect(schema.required).toEqual(['score']);
  });

  it('adds openrouter provider cache hints by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: {},
      json: async () => ({})
    });
    vi.stubGlobal('fetch', fetchMock as any);

    await service.sendChatMessage({
      model: 'openai/gpt-4o',
      stream: false,
      messages: [
        { role: 'system', content: 's1' },
        { role: 'system', content: 's2' },
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' }
      ]
    });

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.providerOptions).toEqual({
      openrouter: { cacheControl: { type: 'ephemeral' } }
    });
    expect(payload.messages[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(payload.messages[3].cacheControl).toEqual({ type: 'ephemeral' });
  });
});
