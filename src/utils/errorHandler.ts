import { GentlyError, ErrorCategory } from './GentlyError';

export class AgentError extends GentlyError {
    public readonly code: string;
    constructor(message: string, code: string = 'AGENT_ERROR', details?: any) {
        super(ErrorCategory.AGENT, message, details);
        this.name = 'AgentError';
        this.code = code;
    }
}

export class ToolError extends AgentError {
    constructor(toolName: string, message: string, details?: any) {
        super(`Tool '${toolName}' error: ${message}`, 'TOOL_ERROR', details);
        this.name = 'ToolError';
    }
}

export class FileError extends AgentError {
    constructor(filePath: string, message: string) {
        super(`File '${filePath}' error: ${message}`, 'FILE_ERROR');
        this.name = 'FileError';
    }
}

export class MemoryError extends AgentError {
    constructor(message: string) {
        super(message, 'MEMORY_ERROR');
        this.name = 'MemoryError';
    }
}

export class ValidationError extends AgentError {
    constructor(message: string) {
        super(message, 'VALIDATION_ERROR');
        this.name = 'ValidationError';
    }
}

export class NetworkError extends AgentError {
    constructor(message: string) {
        super(message, 'NETWORK_ERROR');
        this.name = 'NetworkError';
    }
}

export class ErrorHandler {
    static handle(error: any, context: string): void {
        console.error(`[${context}] Error:`, error.message || error, error.details || '');
    }

    static handleAndRethrow(error: any, context: string): never {
        this.handle(error, context);
        throw error;
    }

    static createErrorResponse(error: any, context: string) {
        this.handle(error, context);
        return {
            success: false,
            error: error.message || String(error),
            code: error.code || 'UNKNOWN_ERROR',
            details: error.details || (error instanceof AgentError ? error.details : undefined)
        };
    }

    static async wrapAsync<T>(fn: () => Promise<T>, context: string): Promise<{ success: true; data: T } | { success: false; error: string; code?: string; details?: any }> {
        try {
            const data = await fn();
            return { success: true, data };
        } catch (error: any) {
            this.handle(error, context);
            return { 
                success: false, 
                error: error.message || String(error),
                code: error.code,
                details: error.details
            };
        }
    }

    static wrapSync<T>(fn: () => T, context: string): { success: true; data: T } | { success: false; error: string; code?: string; details?: any } {
        try {
            const data = fn();
            return { success: true, data };
        } catch (error: any) {
            this.handle(error, context);
            return { 
                success: false, 
                error: error.message || String(error),
                code: error.code,
                details: error.details
            };
        }
    }

    static isRecoverable(error: any): boolean {
        return error instanceof NetworkError;
    }

    static getUserFriendlyMessage(error: any): string {
        const msg = (error as any).message || String(error);
        if (msg.includes('ENOENT')) return 'File not found';
        return msg;
    }
}

export function handleErrors(context: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args: any[]) {
            try {
                return await originalMethod.apply(this, args);
            } catch (error) {
                ErrorHandler.handleAndRethrow(error, context);
            }
        };
        return descriptor;
    };
}

export async function safeExecuteResult<T>(fn: () => Promise<T>, fallback: T, context: string): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        ErrorHandler.handle(error, context);
        return fallback;
    }
}

export async function retry<T>(fn: () => Promise<T>, retries: number, delay: number, context: string): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            if (!ErrorHandler.isRecoverable(error)) throw error;
            console.warn(`[${context}] Retry ${i + 1}/${retries} after error:`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
