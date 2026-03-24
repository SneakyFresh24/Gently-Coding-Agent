/**
 * Gently Error Categories
 */
export enum ErrorCategory {
    SYSTEM = 'SYSTEM',
    RETRIEVAL = 'RETRIEVAL',
    NATIVE_DEP = 'NATIVE_DEP',
    AGENT = 'AGENT',
    VALIDATION = 'VALIDATION',
    API = 'API'
}

/**
 * Modernized Error Class for Gently
 */
export class GentlyError extends Error {
    public readonly timestamp: number;

    constructor(
        public readonly category: ErrorCategory,
        message: string,
        public readonly details?: any,
        public readonly isFatal: boolean = false
    ) {
        super(message);
        this.name = 'GentlyError';
        this.timestamp = Date.now();
        
        // Ensure stack trace is captured correctly
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GentlyError);
        }
    }

    public toJSON() {
        return {
            name: this.name,
            category: this.category,
            message: this.message,
            timestamp: this.timestamp,
            isFatal: this.isFatal,
            details: this.details,
            stack: this.stack
        };
    }
}
