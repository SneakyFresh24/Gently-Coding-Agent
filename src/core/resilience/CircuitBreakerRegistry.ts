import * as vscode from 'vscode';
import { CircuitBreaker, CircuitDecision } from './CircuitBreaker';

export type CircuitDomain = 'llm.stream' | 'tool.execute';
export type CircuitTransition = 'opened' | 'half_open' | 'closed';

export class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker>();

  private static instance: CircuitBreakerRegistry;

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  resolveKey(domain: CircuitDomain, toolName?: string): string {
    if (domain !== 'tool.execute' || !toolName || !this.isPerToolEnabled()) {
      return domain;
    }
    const perTool = this.getPerToolNames();
    if (!perTool.has(toolName)) return domain;
    return `${domain}:${toolName}`;
  }

  canExecute(domain: CircuitDomain, toolName?: string): { key: string; decision: CircuitDecision; transition?: CircuitTransition } {
    const key = this.resolveKey(domain, toolName);
    const breaker = this.getOrCreate(key);
    const before = breaker.getState();
    const decision = breaker.canExecute();
    const after = breaker.getState();
    const transition = before !== 'HALF_OPEN' && after === 'HALF_OPEN' ? 'half_open' : undefined;
    return { key, decision, transition };
  }

  recordSuccess(domain: CircuitDomain, toolName?: string): { key: string; transition?: CircuitTransition } {
    const key = this.resolveKey(domain, toolName);
    const breaker = this.getOrCreate(key);
    const before = breaker.getState();
    breaker.recordSuccess();
    const after = breaker.getState();
    const transition = before !== 'CLOSED' && after === 'CLOSED' ? 'closed' : undefined;
    return { key, transition };
  }

  recordFailure(domain: CircuitDomain, recoverable: boolean, toolName?: string): { key: string; tripped: boolean; transition?: CircuitTransition } {
    const key = this.resolveKey(domain, toolName);
    const breaker = this.getOrCreate(key);
    const before = breaker.getState();
    if (recoverable) {
      breaker.recordFailure();
    }
    const after = breaker.getState();
    const tripped = before !== 'OPEN' && after === 'OPEN';
    const transition = tripped ? 'opened' : undefined;
    return { key, tripped, transition };
  }

  getState(domain: CircuitDomain, toolName?: string): { key: string; state: string } {
    const key = this.resolveKey(domain, toolName);
    return { key, state: this.getOrCreate(key).getState() };
  }

  private getOrCreate(key: string): CircuitBreaker {
    const existing = this.breakers.get(key);
    if (existing) return existing;
    const breaker = new CircuitBreaker(this.getConfig());
    this.breakers.set(key, breaker);
    return breaker;
  }

  private getConfig() {
    const config = vscode.workspace.getConfiguration('gently');
    const failureThreshold = Math.max(1, Number(config.get<number>('resilience.circuit.failureThreshold', 5) || 5));
    const cooldownMs = Math.max(1000, Number(config.get<number>('resilience.circuit.cooldownMs', 300000) || 300000));
    const halfOpenMaxTrials = Math.max(1, Number(config.get<number>('resilience.circuit.halfOpenMaxTrials', 1) || 1));
    return {
      failureThreshold,
      cooldownMs,
      halfOpenMaxTrials
    };
  }

  private isPerToolEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('gently');
    return config.get<boolean>('resilience.circuit.perToolEnabled', false);
  }

  private getPerToolNames(): Set<string> {
    const config = vscode.workspace.getConfiguration('gently');
    const raw = config.get<string[]>('resilience.circuit.perToolTargets', ['write_file', 'run_command']) || [];
    return new Set(raw.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()));
  }
}
