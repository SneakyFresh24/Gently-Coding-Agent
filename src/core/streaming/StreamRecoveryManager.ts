import { StreamChunk } from './types';

export type StreamRecoveryState = 'STREAMING' | 'DISCONNECTED' | 'RECONNECTING' | 'FAILED';

class StreamDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamDivergenceError';
  }
}

export class StreamRecoveryManager {
  private emittedContent = '';
  private emittedReasoning = '';
  private emittedToolArgs = new Map<string, string>();
  private emittedToolStarts = new Set<string>();
  private emittedToolReady = new Set<string>();
  private emittedUsage = false;

  private replayContent = '';
  private replayReasoning = '';
  private replayToolArgs = new Map<string, string>();

  private divergenceCount = 0;
  private readonly maxDivergences: number;

  constructor(maxDivergences = 1) {
    this.maxDivergences = Math.max(1, maxDivergences);
  }

  beginReconnectAttempt(): void {
    this.replayContent = '';
    this.replayReasoning = '';
    this.replayToolArgs = new Map<string, string>();
  }

  process(chunk: StreamChunk): StreamChunk[] {
    switch (chunk.type) {
      case 'text':
        return this.handleTextChunk(chunk.text, 'content');
      case 'reasoning':
        return this.handleTextChunk(chunk.reasoning, 'reasoning');
      case 'tool_call_start': {
        const key = this.toolKey(chunk.toolCallId, chunk.index);
        if (this.emittedToolStarts.has(key)) return [];
        this.emittedToolStarts.add(key);
        return [chunk];
      }
      case 'tool_call_delta': {
        const key = this.toolKey(chunk.toolCallId, chunk.index);
        return this.handleToolDelta(key, chunk);
      }
      case 'tool_call_ready': {
        const key = this.toolKey(chunk.toolCall.id, chunk.index);
        if (this.emittedToolReady.has(key)) return [];
        this.emittedToolReady.add(key);
        return [chunk];
      }
      case 'tool_call_incomplete':
        return [chunk];
      case 'usage':
        if (this.emittedUsage) return [];
        this.emittedUsage = true;
        return [chunk];
      case 'error':
      case 'partial_update':
        return [chunk];
      default:
        return [chunk];
    }
  }

  private handleTextChunk(
    delta: string,
    mode: 'content' | 'reasoning'
  ): StreamChunk[] {
    if (!delta) return [];
    const emitted = mode === 'content' ? this.emittedContent : this.emittedReasoning;
    const replay = mode === 'content' ? this.replayContent : this.replayReasoning;
    const attemptCombined = `${replay}${delta}`;

    if (emitted.startsWith(attemptCombined)) {
      if (mode === 'content') {
        this.replayContent = attemptCombined;
      } else {
        this.replayReasoning = attemptCombined;
      }
      return [];
    }

    if (attemptCombined.startsWith(emitted)) {
      const suffix = attemptCombined.slice(emitted.length);
      if (mode === 'content') {
        this.emittedContent = attemptCombined;
        this.replayContent = attemptCombined;
        return suffix ? [{ type: 'text', text: suffix }] : [];
      }

      this.emittedReasoning = attemptCombined;
      this.replayReasoning = attemptCombined;
      return suffix ? [{ type: 'reasoning', reasoning: suffix }] : [];
    }

    this.handleDivergence(`Text stream diverged during ${mode} recovery`);
    return [];
  }

  private handleToolDelta(key: string, chunk: Extract<StreamChunk, { type: 'tool_call_delta' }>): StreamChunk[] {
    const emittedArgs = this.emittedToolArgs.get(key) || '';
    const replayArgs = this.replayToolArgs.get(key) || '';
    const attemptCombinedArgs = `${replayArgs}${chunk.delta}`;

    if (emittedArgs.startsWith(attemptCombinedArgs)) {
      this.replayToolArgs.set(key, attemptCombinedArgs);
      return [];
    }

    if (attemptCombinedArgs.startsWith(emittedArgs)) {
      const suffix = attemptCombinedArgs.slice(emittedArgs.length);
      this.replayToolArgs.set(key, attemptCombinedArgs);
      this.emittedToolArgs.set(key, attemptCombinedArgs);
      if (!suffix) return [];
      return [{
        ...chunk,
        delta: suffix
      }];
    }

    this.handleDivergence(`Tool argument stream diverged for ${key}`);
    return [];
  }

  private handleDivergence(message: string): void {
    this.divergenceCount += 1;
    if (this.divergenceCount > this.maxDivergences) {
      throw new StreamDivergenceError(message);
    }
  }

  private toolKey(id: string, index: number): string {
    return `${id || 'unknown'}::${index}`;
  }
}

export function isStreamDivergenceError(error: unknown): boolean {
  return error instanceof Error && error.name === 'StreamDivergenceError';
}
