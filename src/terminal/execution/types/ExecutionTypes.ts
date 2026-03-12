// =====================================================
// Execution Types - Type definitions for command execution
// =====================================================

/**
 * Command execution options
 */
export interface ExecutionOptions {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    shell?: boolean;
    autoConfirm?: boolean;
    streamOutput?: boolean;
}

/**
 * Output chunk from command execution
 */
export interface OutputChunk {
    type: 'status' | 'stdout' | 'stderr' | 'complete' | 'error';
    data?: string;
    message?: string;
    exitCode?: number;
    duration?: number;
    timestamp: number;
}

/**
 * Command execution result
 */
export interface CommandResult {
    commandId?: string;
    command?: string;
    output: string;
    stdout?: string;
    stderr?: string;
    exitCode: number;
    duration: number;
    success: boolean;
    startTime?: number;
    endTime?: number;
}

/**
 * Output chunk callback
 */
export type OutputChunkCallback = (chunk: OutputChunk) => void;

/**
 * Command execution interface
 */
export interface CommandExecutor {
    executeStreaming(
        commandId: string,
        command: string,
        options: ExecutionOptions,
        onChunk: OutputChunkCallback
    ): Promise<CommandResult>;

    killCommand(commandId: string): void;
    isCommandRunning(commandId: string): boolean;
    getActiveCommands(): string[];
    dispose(): void;
}
