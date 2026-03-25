export type ModelFamily =
  | 'claude'
  | 'gpt'
  | 'gemini'
  | 'llama'
  | 'deepseek'
  | 'grok'
  | 'mistral'
  | 'qwen'
  | 'minimax'
  | 'glm'
  | 'kimi'
  | 'hermes'
  | 'trinity'
  | 'deepseek32'
  | 'unknown';

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningType = 'enabled' | 'adaptive';
export type ProviderKey = 'anthropic' | 'openrouter' | 'bedrock' | 'openaiCompatible';

export interface ReasoningConfig {
  effort?: ReasoningEffort;
  budgetTokens?: number;
  thinkingBudget?: number;
  thinkingLevel?: 'low' | 'medium' | 'high';
  thinkingType?: ReasoningType;
}

export interface ProviderCacheHints {
  anthropic?: { cacheControl: { type: 'ephemeral' } };
  openrouter?: { cacheControl: { type: 'ephemeral' } };
  bedrock?: { cachePoint: { type: 'default' } };
  openaiCompatible?: { cache_control: { type: 'ephemeral' } };
}

export interface ModelPolicyResult {
  family: ModelFamily;
  skipReasoning: boolean;
  requiresSequenceFix: boolean;
  webpUnsupported: boolean;
  recommendedTemperature: number;
  recommendedTopP: number;
  recommendedTopK?: number;
}

function normalizeModelId(modelId?: string): string {
  return (modelId || '').trim().toLowerCase();
}

export function isClaudeModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('claude') || model.includes('anthropic/');
}

export function isGPTModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('gpt') || model.includes('openai/');
}

export function isGeminiModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('gemini');
}

export function isLlamaModelFamily(modelId?: string): boolean {
  return normalizeModelId(modelId).includes('llama');
}

export function isDeepSeekModelFamily(modelId?: string): boolean {
  return normalizeModelId(modelId).includes('deepseek');
}

export function isGrokModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('grok') || model.includes('xai/');
}

export function isMistralModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('mistral') || model.includes('devstral');
}

export function isQwenModelFamily(modelId?: string): boolean {
  return normalizeModelId(modelId).includes('qwen');
}

export function isMinimaxModelFamily(modelId?: string): boolean {
  return normalizeModelId(modelId).includes('minimax');
}

export function isGLMModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('glm') || model.includes('zhipu');
}

export function isKimiModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('kimi') || model.includes('moonshot');
}

export function isHermesModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('hermes-4') || model.includes('hermes4') || model.includes('nous/hermes-4') || model.includes('nousresearch/hermes-4');
}

export function isTrinityModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('arcee-ai/trinity') || model.includes('trinity');
}

export function isDeepSeek32ModelFamily(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('deepseek') && model.includes('3.2') && !model.includes('speciale');
}

export function detectModelFamily(modelId?: string): ModelFamily {
  if (isHermesModelFamily(modelId)) return 'hermes';
  if (isTrinityModelFamily(modelId)) return 'trinity';
  if (isDeepSeek32ModelFamily(modelId)) return 'deepseek32';
  if (isClaudeModelFamily(modelId)) return 'claude';
  if (isGPTModelFamily(modelId)) return 'gpt';
  if (isGeminiModelFamily(modelId)) return 'gemini';
  if (isLlamaModelFamily(modelId)) return 'llama';
  if (isDeepSeekModelFamily(modelId)) return 'deepseek';
  if (isGrokModelFamily(modelId)) return 'grok';
  if (isMistralModelFamily(modelId)) return 'mistral';
  if (isQwenModelFamily(modelId)) return 'qwen';
  if (isMinimaxModelFamily(modelId)) return 'minimax';
  if (isGLMModelFamily(modelId)) return 'glm';
  if (isKimiModelFamily(modelId)) return 'kimi';
  return 'unknown';
}

export function shouldSkipReasoningForModel(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  if (!model) return false;
  return model.includes('grok-4') || model.includes('devstral') || isGLMModelFamily(model);
}

export function modelDoesntSupportWebp(modelId?: string): boolean {
  return isGrokModelFamily(modelId) || isGLMModelFamily(modelId) || normalizeModelId(modelId).includes('devstral');
}

export function requiresMessageSequenceFix(modelId?: string): boolean {
  const model = normalizeModelId(modelId);
  return model.includes('mistral') || model.includes('devstral');
}

export function normalizeToolCallIdForClaude(id: string): string {
  const normalized = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return normalized.length > 0 ? normalized : 'tool_call';
}

export function getReasoningConfig(
  modelId: string | undefined,
  effort: ReasoningEffort = 'medium',
  _provider?: ProviderKey
): ReasoningConfig {
  const model = normalizeModelId(modelId);
  if (!model) return {};

  // Explicitly unsupported / no-op families.
  if (
    isDeepSeekModelFamily(model) ||
    isMinimaxModelFamily(model) ||
    isGLMModelFamily(model) ||
    isMistralModelFamily(model) ||
    isKimiModelFamily(model)
  ) {
    return {};
  }

  if (isGPTModelFamily(model)) {
    if (model.includes('gpt-5-pro')) return {};
    const allowed: ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
    return { effort: allowed.includes(effort) ? effort : 'medium' };
  }

  if (isClaudeModelFamily(model)) {
    const is46 = model.includes('4.6');
    if (is46) {
      const allowed: ReasoningEffort[] = ['low', 'medium', 'high', 'max'];
      return {
        effort: allowed.includes(effort) ? effort : 'medium',
        thinkingType: 'adaptive'
      };
    }
    return {
      effort: effort === 'max' ? 'max' : 'high',
      budgetTokens: effort === 'max' ? 32000 : 16000,
      thinkingType: 'enabled'
    };
  }

  if (isGeminiModelFamily(model)) {
    if (model.includes('2.5')) {
      return { effort, thinkingBudget: effort === 'high' || effort === 'xhigh' ? 24576 : 16000 };
    }
    if (model.includes('3.')) {
      const thinkingLevel = effort === 'low' ? 'low' : (effort === 'high' || effort === 'xhigh' || effort === 'max') ? 'high' : 'medium';
      return { effort, thinkingLevel };
    }
    return { effort };
  }

  if (isGrokModelFamily(model)) {
    if (model.includes('grok-3-mini')) {
      return { effort: effort === 'high' ? 'high' : 'low' };
    }
    return {};
  }

  return {};
}

export function getRecommendedTemperature(modelId?: string): number {
  const model = normalizeModelId(modelId);
  if (model.includes('minimax-m2')) return 1.0;
  if (model.includes('minimax-m1')) return 0.7;
  if (isClaudeModelFamily(model)) return 0.5;
  return 0.7;
}

export function getRecommendedTopP(modelId?: string): number {
  const model = normalizeModelId(modelId);
  if (isClaudeModelFamily(model)) return 0.95;
  if (isGeminiModelFamily(model)) return 0.9;
  return 1.0;
}

export function getRecommendedTopK(modelId?: string): number | undefined {
  const model = normalizeModelId(modelId);
  if (model.includes('minimax-m2')) return 40;
  if (model.includes('minimax-m1')) return 20;
  return undefined;
}

export function getModelPolicyResult(modelId?: string): ModelPolicyResult {
  return {
    family: detectModelFamily(modelId),
    skipReasoning: shouldSkipReasoningForModel(modelId),
    requiresSequenceFix: requiresMessageSequenceFix(modelId),
    webpUnsupported: modelDoesntSupportWebp(modelId),
    recommendedTemperature: getRecommendedTemperature(modelId),
    recommendedTopP: getRecommendedTopP(modelId),
    recommendedTopK: getRecommendedTopK(modelId)
  };
}

export function getProviderCacheHints(provider: ProviderKey): ProviderCacheHints {
  if (provider === 'anthropic') return { anthropic: { cacheControl: { type: 'ephemeral' } } };
  if (provider === 'openrouter') return { openrouter: { cacheControl: { type: 'ephemeral' } } };
  if (provider === 'bedrock') return { bedrock: { cachePoint: { type: 'default' } } };
  return { openaiCompatible: { cache_control: { type: 'ephemeral' } } };
}

function sanitizeGeminiSchemaNode(node: any): any {
  if (!node || typeof node !== 'object') return node;

  const clone: any = Array.isArray(node) ? node.map(sanitizeGeminiSchemaNode) : { ...node };

  if (clone.type === 'integer' && Array.isArray(clone.enum)) {
    clone.type = 'string';
    clone.enum = clone.enum.map((entry: unknown) => String(entry));
  }

  if (clone.properties && typeof clone.properties === 'object') {
    const nextProperties: Record<string, any> = {};
    for (const [key, value] of Object.entries(clone.properties)) {
      nextProperties[key] = sanitizeGeminiSchemaNode(value);
    }
    clone.properties = nextProperties;
  }

  if (Array.isArray(clone.required) && clone.properties && typeof clone.properties === 'object') {
    const allowedKeys = new Set(Object.keys(clone.properties));
    clone.required = clone.required.filter((key: unknown) => typeof key === 'string' && allowedKeys.has(key));
  }

  if (clone.items) clone.items = sanitizeGeminiSchemaNode(clone.items);
  if (clone.anyOf) clone.anyOf = sanitizeGeminiSchemaNode(clone.anyOf);
  if (clone.oneOf) clone.oneOf = sanitizeGeminiSchemaNode(clone.oneOf);
  if (clone.allOf) clone.allOf = sanitizeGeminiSchemaNode(clone.allOf);

  return clone;
}

export function sanitizeSchemaForGemini(schema: unknown): unknown {
  return sanitizeGeminiSchemaNode(schema);
}

// Hook-point for future image payload pipeline.
export function getImageMimeFallback(modelId: string | undefined, mimeType: string): string {
  if (!modelDoesntSupportWebp(modelId)) return mimeType;
  const normalized = (mimeType || '').toLowerCase();
  if (normalized === 'image/webp') return 'image/png';
  return mimeType;
}
