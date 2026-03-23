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
