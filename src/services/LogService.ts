import { telemetry } from './Telemetry';

export interface LogEntry {
    timestamp: string;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    context: string;
    event: string;
    message: string;
    metadata?: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
}

export class LogService {
    constructor(private context: string) { }

    info(message: string, ...args: any[]): void {
        this.emit('INFO', message, args);
    }

    error(message: string, error?: any): void {
        this.emit('ERROR', message, [error]);
    }

    warn(message: string, ...args: any[]): void {
        this.emit('WARN', message, args);
    }

    debug(message: string, ...args: any[]): void {
        this.emit('DEBUG', message, args);
    }

    event(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', event: string, message: string, metadata?: Record<string, unknown>): void {
        const traceContext = telemetry.getActiveTraceContext();
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            context: this.context,
            event,
            message,
            ...(metadata ? { metadata } : {}),
            ...(traceContext.traceId ? { traceId: traceContext.traceId } : {}),
            ...(traceContext.spanId ? { spanId: traceContext.spanId } : {})
        };
        this.write(entry);
    }

    private emit(level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR', message: string, args: any[]): void {
        const metadata = this.normalizeMetadata(args);
        this.event(level, 'log', message, metadata);
    }

    private normalizeMetadata(args: any[]): Record<string, unknown> | undefined {
        if (!args || args.length === 0) return undefined;
        return {
            args: args.map((arg) => {
                if (arg instanceof Error) {
                    return {
                        name: arg.name,
                        message: arg.message,
                        stack: arg.stack
                    };
                }
                return arg as unknown;
            })
        };
    }

    private write(entry: LogEntry): void {
        const serialized = JSON.stringify(entry);
        switch (entry.level) {
            case 'ERROR':
                console.error(serialized);
                break;
            case 'WARN':
                console.warn(serialized);
                break;
            case 'DEBUG':
                console.debug(serialized);
                break;
            case 'INFO':
            default:
                console.log(serialized);
                break;
        }
    }
}
