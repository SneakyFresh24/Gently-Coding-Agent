import * as vscode from 'vscode';
import { telemetry } from '../services/Telemetry';

/**
 * Centralized logging utility for the Gently extension
 */
export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Gently');
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, ...args: any[]): void {
    const traceContext = telemetry.getActiveTraceContext();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context: 'Logger',
      event: 'log',
      message,
      ...(args.length > 0 ? { metadata: { args } } : {}),
      ...(traceContext.traceId ? { traceId: traceContext.traceId } : {}),
      ...(traceContext.spanId ? { spanId: traceContext.spanId } : {})
    };
    const serialized = JSON.stringify(entry);
    this.outputChannel.appendLine(serialized);

    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else if (level === 'DEBUG') {
      console.debug(serialized);
    } else {
      console.log(serialized);
    }
  }

  public info(message: string, ...args: any[]): void {
    this.log('INFO', message, ...args);
  }

  public error(message: string, ...args: any[]): void {
    this.log('ERROR', message, ...args);
  }

  public debug(message: string, ...args: any[]): void {
    this.log('DEBUG', message, ...args);
  }

  public warn(message: string, ...args: any[]): void {
    this.log('WARN', message, ...args);
  }

  /**
   * Safe execution wrapper with automatic logging
   */
  public async safeExecute<T>(
    operation: () => Promise<T>,
    fallbackValue?: T,
    context?: string
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error) {
      this.error(`Error in ${context || 'operation'}:`, error);
      return fallbackValue;
    }
  }
}

// Centralized logger instances
export const LoggerInstance = Logger.getInstance();
export const agentLogger = LoggerInstance;
export const PerformanceLogger = {
  measure: async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await operation();
    } finally {
      const duration = Date.now() - start;
      LoggerInstance.info(`[Performance] ${name} took ${duration}ms`);
    }
  }
};

/**
 * Global safeExecute wrapper
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  fallbackValue?: T,
  context?: string
): Promise<T | undefined> {
  return LoggerInstance.safeExecute(operation, fallbackValue, context);
}
