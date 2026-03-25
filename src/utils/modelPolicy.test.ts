import { describe, expect, it } from 'vitest';
import {
  detectModelFamily,
  getImageMimeFallback,
  getModelPolicyResult,
  getProviderCacheHints,
  getRecommendedTemperature,
  getRecommendedTopK,
  getRecommendedTopP,
  getReasoningConfig,
  isDeepSeek32ModelFamily,
  isHermesModelFamily,
  isTrinityModelFamily,
  modelDoesntSupportWebp,
  normalizeToolCallIdForClaude,
  requiresMessageSequenceFix,
  sanitizeSchemaForGemini,
  shouldSkipReasoningForModel
} from './modelPolicy';

describe('modelPolicy family detection', () => {
  it('detects hermes, trinity and deepseek 3.2 variants', () => {
    expect(isHermesModelFamily('nous/hermes-4')).toBe(true);
    expect(isTrinityModelFamily('arcee-ai/trinity-lite')).toBe(true);
    expect(isDeepSeek32ModelFamily('deepseek-r1-3.2')).toBe(true);
    expect(isDeepSeek32ModelFamily('deepseek-r1-speciale-3.2')).toBe(false);
  });

  it('detects kimi model family variants', () => {
    expect(detectModelFamily('kimi-k2.5')).toBe('kimi');
    expect(detectModelFamily('moonshot/kimi-k2-thinking')).toBe('kimi');
  });
});

describe('modelPolicy reasoning and sequencing', () => {
  it('marks noisy reasoning models for skip', () => {
    expect(shouldSkipReasoningForModel('xai/grok-4-beta')).toBe(true);
    expect(shouldSkipReasoningForModel('mistral/devstral-small')).toBe(true);
    expect(shouldSkipReasoningForModel('zhipu/glm-4.6')).toBe(true);
    expect(shouldSkipReasoningForModel('openai/gpt-4.1')).toBe(false);
  });

  it('requires sequence fix for mistral/devstral', () => {
    expect(requiresMessageSequenceFix('mistral/medium')).toBe(true);
    expect(requiresMessageSequenceFix('devstral/latest')).toBe(true);
    expect(requiresMessageSequenceFix('openai/gpt-4o')).toBe(false);
  });

  it('returns empty reasoning config for unsupported families', () => {
    expect(getReasoningConfig('deepseek/deepseek-chat')).toEqual({});
    expect(getReasoningConfig('minimax/minimax-m1')).toEqual({});
    expect(getReasoningConfig('glm/glm-4.6')).toEqual({});
    expect(getReasoningConfig('mistral/medium')).toEqual({});
    expect(getReasoningConfig('moonshot/kimi-k2.5')).toEqual({});
  });
});

describe('modelPolicy reasoning matrix', () => {
  it('maps GPT-5 variants and blocks gpt-5-pro', () => {
    expect(getReasoningConfig('openai/gpt-5', 'xhigh')).toEqual({ effort: 'xhigh' });
    expect(getReasoningConfig('openai/gpt-5-pro', 'high')).toEqual({});
  });

  it('maps Claude generations with budgets and thinking type', () => {
    expect(getReasoningConfig('anthropic/claude-4.6-sonnet', 'low')).toEqual({
      effort: 'low',
      thinkingType: 'adaptive'
    });
    expect(getReasoningConfig('anthropic/claude-3.7-sonnet', 'max')).toEqual({
      effort: 'max',
      budgetTokens: 32000,
      thinkingType: 'enabled'
    });
  });

  it('maps Gemini 2.5 and 3.x thinking fields', () => {
    expect(getReasoningConfig('google/gemini-2.5-pro', 'high')).toEqual({
      effort: 'high',
      thinkingBudget: 24576
    });
    expect(getReasoningConfig('google/gemini-3.0', 'low')).toEqual({
      effort: 'low',
      thinkingLevel: 'low'
    });
  });
});

describe('modelPolicy cache/schema/webp helpers', () => {
  it('returns provider cache hint payloads', () => {
    expect(getProviderCacheHints('openrouter')).toEqual({
      openrouter: { cacheControl: { type: 'ephemeral' } }
    });
    expect(getProviderCacheHints('bedrock')).toEqual({
      bedrock: { cachePoint: { type: 'default' } }
    });
  });

  it('sanitizes Gemini schema integer enums and required fields', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'integer', enum: [1, 2, 3] },
        name: { type: 'string' }
      },
      required: ['status', 'missing']
    };
    const sanitized = sanitizeSchemaForGemini(schema) as any;
    expect(sanitized.properties.status.type).toBe('string');
    expect(sanitized.properties.status.enum).toEqual(['1', '2', '3']);
    expect(sanitized.required).toEqual(['status']);
  });

  it('normalizes claude tool call IDs and checks webp fallback hooks', () => {
    expect(normalizeToolCallIdForClaude('tool_üñïçödé_123')).toBe('tool_______d__123');
    expect(modelDoesntSupportWebp('xai/grok-4')).toBe(true);
    expect(modelDoesntSupportWebp('openai/gpt-4o')).toBe(false);
    expect(getImageMimeFallback('xai/grok-4', 'image/webp')).toBe('image/png');
    expect(getImageMimeFallback('openai/gpt-4o', 'image/webp')).toBe('image/webp');
  });

  it('returns stable model policy recommendations', () => {
    expect(getRecommendedTemperature('minimax/minimax-m2')).toBe(1.0);
    expect(getRecommendedTopP('anthropic/claude-4.1')).toBe(0.95);
    expect(getRecommendedTopK('minimax/minimax-m1')).toBe(20);
    const policy = getModelPolicyResult('xai/grok-4');
    expect(policy.family).toBe('grok');
    expect(policy.skipReasoning).toBe(true);
    expect(policy.webpUnsupported).toBe(true);
  });
});
