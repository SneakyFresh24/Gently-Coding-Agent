import * as vscode from 'vscode';
import { CircuitBreaker, CircuitDecision } from './CircuitBreaker';

export type CircuitDomain = 'llm.stream' | 'tool.execute';

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

  canExecute(domain: CircuitDomain, toolName?: string): { key: string; decision: CircuitDecision } {
    const key = this.resolveKey(domain, toolName);
    const breaker = this.getOrCreate(key);
    return { key, decision: breaker.canExecute() };
  }

  recordSuccess(domain: CircuitDomain, toolName?: string): { key: string } {
    const key = this.resolveKey(domain, toolName);
    this.getOrCreate(key).recordSuccess();
    return { key };
  }

  recordFailure(domain: CircuitDomain, recoverable: boolean, toolName?: string): { key: string; tripped: boolean } {
    const key = this.resolveKey(domain, toolName);
    const breaker = this.getOrCreate(key);
    const before = breaker.getState();
    if (recoverable) {
      breaker.recordFailure();
    }
    const after = breaker.getState();
    return { key, tripped: before !== 'OPEN' && after === 'OPEN' };
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
