import { TerminalManager } from '../../terminal/TerminalManager';
import { ToolRegistry } from './ToolRegistry';

export class CommandTools {
    constructor(
        private getTerminalManager: () => TerminalManager | null,
        private emitEvent: (event: any) => void
    ) { }

    /**
     * Set the event callback dynamically
     */
    public setEventCallback(callback: (event: any) => void): void {
        this.emitEvent = callback;
    }

    /**
     * Register all command-related tools
     */
    registerTools(registry: ToolRegistry): void {
        registry.register('run_command', this.runCommand.bind(this));
    }

    /**
     * Execute a shell command
     */
    private async runCommand(params: {
        command: string;
        description: string;
        autoConfirm?: boolean;
        cwd?: string;
    }): Promise<any> {
        try {
            const terminalManager = this.getTerminalManager();
            if (!terminalManager) {
                return {
                    success: false,
                    message: 'Terminal Manager is not available. Cannot execute command.'
                };
            }

            console.log(`[CommandTools] Proposing command: ${params.command}`);
            console.log(`[CommandTools] Reason: ${params.description}`);

            // Emit event for UI/Tracking
            this.emitEvent({
                type: 'commandProposed',
                command: params.command,
                description: params.description,
                autoConfirm: params.autoConfirm || false
            });

            // Execute command via TerminalManager — pass autoConfirm through
            const result = await terminalManager.executeCommand(
                params.command,
                params.description,
                {
                    cwd: params.cwd,
                    autoConfirm: params.autoConfirm || false
                } as any
            );

            return {
                success: result.success,
                output: result.output,
                exitCode: result.exitCode,
                duration: result.duration
            };
        } catch (error) {
            console.error('[CommandTools] Command execution failed:', error);

            // Distinguish user-denied from real errors
            const msg = error instanceof Error ? error.message : String(error);
            if (msg.includes('rejected by user')) {
                return {
                    success: false,
                    denied: true,
                    message: 'User denied execution of this command.'
                };
            }

            return {
                success: false,
                message: `Command execution failed: ${msg}`
            };
        }
    }
}

