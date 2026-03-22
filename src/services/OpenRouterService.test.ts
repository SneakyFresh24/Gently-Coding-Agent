import { describe, expect, it } from 'vitest';
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
});

