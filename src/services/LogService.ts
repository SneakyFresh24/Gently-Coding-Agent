export class LogService {
    constructor(private context: string) { }

    info(message: string, ...args: any[]): void {
        console.log(`[INFO][${this.context}] ${message}`, ...args);
    }

    error(message: string, error?: any): void {
        console.error(`[ERROR][${this.context}] ${message}`, error || '');
    }

    warn(message: string, ...args: any[]): void {
        console.warn(`[WARN][${this.context}] ${message}`, ...args);
    }

    debug(message: string, ...args: any[]): void {
        console.debug(`[DEBUG][${this.context}] ${message}`, ...args);
    }
}
