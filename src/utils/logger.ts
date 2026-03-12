// =====================================================
// Logger - Centralized logging utility
// =====================================================

import * as vscode from 'vscode';
import { LOG_MESSAGES } from './constants';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: any;
}

/**
 * Logger class for consistent logging across the application
 */
export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;
  private logs: LogEntry[] = [];
  private maxLogEntries: number = 1000;
  private outputChannel?: vscode.OutputChannel;

  private constructor() {
    // Create output channel for VSCode
    this.outputChannel = vscode.window.createOutputChannel('Gently Agent');
  }

  /**
   * Get singleton instance
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Set max log entries
   */
  setMaxLogEntries(max: number): void {
    this.maxLogEntries = max;
    this.trimLogs();
  }

  /**
   * Debug log
   */
  debug(category: string, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, category, message, data);
  }

  /**
   * Info log
   */
  info(category: string, message: string, data?: any): void {
    this.log(LogLevel.INFO, category, message, data);
  }

  /**
   * Warning log
   */
  warn(category: string, message: string, data?: any): void {
    this.log(LogLevel.WARN, category, message, data);
  }

  /**
   * Error log
   */
  error(category: string, message: string, data?: any): void {
    this.log(LogLevel.ERROR, category, message, data);
  }

  /**
   * Log with specified level
   */
  private log(level: LogLevel, category: string, message: string, data?: any): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      category,
      message,
      data
    };

    // Add to logs array
    this.logs.push(logEntry);
    this.trimLogs();

    // Format message for output
    const levelName = LogLevel[level];
    const formattedMessage = `[${timestamp}] [${levelName}] [${category}] ${message}`;

    // Log to console
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage, data);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage, data);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage, data);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage, data);
        break;
    }

    // Log to VSCode output channel
    if (this.outputChannel) {
      this.outputChannel.appendLine(formattedMessage);
      if (data) {
        this.outputChannel.appendLine(JSON.stringify(data, null, 2));
      }
    }
  }

  /**
   * Trim logs to max entries
   */
  private trimLogs(): void {
    if (this.logs.length > this.maxLogEntries) {
      this.logs = this.logs.slice(-this.maxLogEntries);
    }
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Get logs by category
   */
  getLogsByCategory(category: string): LogEntry[] {
    return this.logs.filter(log => log.category === category);
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    if (this.outputChannel) {
      this.outputChannel.clear();
    }
  }

  /**
   * Show output channel
   */
  showOutputChannel(): void {
    if (this.outputChannel) {
      this.outputChannel.show();
    }
  }

  /**
   * Hide output channel
   */
  hideOutputChannel(): void {
    if (this.outputChannel) {
      this.outputChannel.hide();
    }
  }

  /**
   * Dispose logger
   */
  dispose(): void {
    if (this.outputChannel) {
      this.outputChannel.dispose();
    }
  }
}

/**
 * Convenience functions for logging
 */
export const logger = Logger.getInstance();

export const logDebug = (category: string, message: string, data?: any): void => {
  logger.debug(category, message, data);
};

export const logInfo = (category: string, message: string, data?: any): void => {
  logger.info(category, message, data);
};

export const logWarn = (category: string, message: string, data?: any): void => {
  logger.warn(category, message, data);
};

export const logError = (category: string, message: string, data?: any): void => {
  logger.error(category, message, data);
};

/**
 * Category-specific loggers
 */
export const agentLogger = {
  debug: (message: string, data?: any) => logDebug('Agent', message, data),
  info: (message: string, data?: any) => logInfo('Agent', message, data),
  warn: (message: string, data?: any) => logWarn('Agent', message, data),
  error: (message: string, data?: any) => logError('Agent', message, data)
};

export const toolLogger = {
  debug: (message: string, data?: any) => logDebug('Tool', message, data),
  info: (message: string, data?: any) => logInfo('Tool', message, data),
  warn: (message: string, data?: any) => logWarn('Tool', message, data),
  error: (message: string, data?: any) => logError('Tool', message, data)
};

export const memoryLogger = {
  debug: (message: string, data?: any) => logDebug('Memory', message, data),
  info: (message: string, data?: any) => logInfo('Memory', message, data),
  warn: (message: string, data?: any) => logWarn('Memory', message, data),
  error: (message: string, data?: any) => logError('Memory', message, data)
};

export const fileLogger = {
  debug: (message: string, data?: any) => logDebug('File', message, data),
  info: (message: string, data?: any) => logInfo('File', message, data),
  warn: (message: string, data?: any) => logWarn('File', message, data),
  error: (message: string, data?: any) => logError('File', message, data)
};

export const validationLogger = {
  debug: (message: string, data?: any) => logDebug('Validation', message, data),
  info: (message: string, data?: any) => logInfo('Validation', message, data),
  warn: (message: string, data?: any) => logWarn('Validation', message, data),
  error: (message: string, data?: any) => logError('Validation', message, data)
};

/**
 * Performance logging utility
 */
export class PerformanceLogger {
  private static timers: Map<string, number> = new Map();

  /**
   * Start a timer
   */
  static start(name: string): void {
    this.timers.set(name, Date.now());
    logDebug('Performance', `Timer started: ${name}`);
  }

  /**
   * End a timer and log the duration
   */
  static end(name: string): number {
    const startTime = this.timers.get(name);
    if (!startTime) {
      logWarn('Performance', `Timer not found: ${name}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(name);
    
    logInfo('Performance', `Timer ended: ${name}`, { duration: `${duration}ms` });
    return duration;
  }

  /**
   * Measure execution time of a function
   */
  static async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      const result = await fn();
      this.end(name);
      return result;
    } catch (error) {
      this.end(name);
      throw error;
    }
  }

  /**
   * Get all active timers
   */
  static getActiveTimers(): string[] {
    return Array.from(this.timers.keys());
  }

  /**
   * Clear all timers
   */
  static clearTimers(): void {
    this.timers.clear();
  }
}

/**
 * Logging decorator for methods
 */
export function logMethodCalls(category: string = 'Method') {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      logDebug(category, `Calling ${propertyName}`, { args });
      
      try {
        const result = await method.apply(this, args);
        const duration = Date.now() - startTime;
        logInfo(category, `Completed ${propertyName}`, { duration: `${duration}ms` });
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        logError(category, `Failed ${propertyName}`, { error, duration: `${duration}ms` });
        throw error;
      }
    };

    return descriptor;
  };
}