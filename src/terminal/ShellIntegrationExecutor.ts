import * as vscode from 'vscode';
import { OutputChunk, CommandResult, ExecutionOptions } from './execution/types/ExecutionTypes';

/**
 * Shell Integration Executor
 * Uses VS Code's native Shell Integration API for reliable command execution
 * Falls back to legacy method for older VS Code versions or unsupported shells
 */
export class ShellIntegrationExecutor {
  private activeExecutions: Map<string, vscode.Disposable> = new Map();
  private activeTerminals: Map<string, vscode.Terminal> = new Map();
  private outputCallbacks: Map<string, (chunk: OutputChunk) => void> = new Map();
  private reusableTerminal: vscode.Terminal | null = null;
  private fallbackStatusBarItem: vscode.StatusBarItem | null = null;
  private static readonly TERMINAL_NAME = 'Gently Terminal';
  private webviewCommunicator?: any;

  constructor(webviewCommunicator?: any) {
    this.webviewCommunicator = webviewCommunicator;
  }

  /**
   * Find or create a reusable terminal
   */
  private getOrCreateTerminal(cwd: string, env?: Record<string, string>): vscode.Terminal {
    // Check if our reusable terminal still exists
    if (this.reusableTerminal) {
      const allTerminals = vscode.window.terminals;
      const terminalExists = allTerminals.some(t => t === this.reusableTerminal);

      if (terminalExists) {
        console.log(`[ShellIntegrationExecutor] Reusing existing terminal: ${ShellIntegrationExecutor.TERMINAL_NAME}`);
        return this.reusableTerminal;
      } else {
        console.log(`[ShellIntegrationExecutor] Previous terminal was closed, creating new one`);
        this.reusableTerminal = null;
      }
    }

    // Look for existing Gently Terminal in VS Code
    const existingTerminal = vscode.window.terminals.find(
      t => t.name === ShellIntegrationExecutor.TERMINAL_NAME
    );

    if (existingTerminal) {
      console.log(`[ShellIntegrationExecutor] Found existing terminal: ${ShellIntegrationExecutor.TERMINAL_NAME}`);
      this.reusableTerminal = existingTerminal;
      return existingTerminal;
    }

    // Create new terminal
    console.log(`[ShellIntegrationExecutor] Creating new terminal: ${ShellIntegrationExecutor.TERMINAL_NAME}`);
    const terminal = vscode.window.createTerminal({
      name: ShellIntegrationExecutor.TERMINAL_NAME,
      cwd: cwd,
      env: env,
    });

    this.reusableTerminal = terminal;
    return terminal;
  }

  /**
   * Check if a command is a long-running process (server, watch mode, etc.)
   */
  private isLongRunningCommand(command: string): boolean {
    const longRunningPatterns = [
      /npm\s+(run\s+)?dev/i,
      /npm\s+(run\s+)?start/i,
      /npm\s+(run\s+)?serve/i,
      /yarn\s+dev/i,
      /yarn\s+start/i,
      /pnpm\s+dev/i,
      /pnpm\s+start/i,
      /cargo\s+run/i,
      /python\s+.*\.py/i,
      /node\s+.*\.js/i,
      /vite/i,
      /webpack-dev-server/i,
      /next\s+dev/i,
      /ng\s+serve/i,
    ];

    return longRunningPatterns.some(pattern => pattern.test(command));
  }

  /**
   * Detect the current terminal shell type
   */
  private async getTerminalShellType(terminal: vscode.Terminal): Promise<string> {
    const shellPath = (terminal.creationOptions as vscode.TerminalOptions).shellPath || '';
    const shellArgs = (terminal.creationOptions as vscode.TerminalOptions).shellArgs || [];

    if (shellPath.toLowerCase().includes('bash.exe') || shellPath.toLowerCase().includes('git-bash')) {
      return 'Git Bash';
    }
    if (shellPath.toLowerCase().includes('pwsh') || shellPath.toLowerCase().includes('powershell')) {
      return 'PowerShell';
    }
    if (shellPath.toLowerCase().includes('cmd.exe')) {
      return 'Command Prompt';
    }

    // Heuristic: check environment if shellPath is empty
    const envShell = process.env.SHELL || '';
    if (envShell.includes('bash')) return 'Bash';
    if (envShell.includes('zsh')) return 'Zsh';

    return 'Unknown Shell';
  }

  /**
   * Show status bar notification for fallback mode
   */
  private showFallbackNotification(shellType: string): void {
    if (!this.fallbackStatusBarItem) {
      this.fallbackStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    }
    this.fallbackStatusBarItem.text = `$(warning) Gently Terminal: Fallback (${shellType})`;
    this.fallbackStatusBarItem.tooltip = `Using process watcher fallback because Shell Integration is not available for ${shellType}`;
    this.fallbackStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.fallbackStatusBarItem.show();

    // Hide after 10 seconds
    setTimeout(() => {
      this.fallbackStatusBarItem?.hide();
    }, 10000);
  }



  /**
   * Execute a command using VS Code Shell Integration API (Cline Method + Interactive Detection)
   *
   * Key insights:
   * 1. The AsyncIterable stream MUST be read completely until it ends
   * 2. BUT: For interactive commands waiting for user input, we detect the prompt and complete early
   * 3. This allows the user to interact with the terminal while Gently continues
   */
  private async executeWithShellIntegration(
    commandId: string,
    command: string,
    terminal: vscode.Terminal,
    options: ExecutionOptions,
    onChunk: (chunk: OutputChunk) => void,
    startTime: number
  ): Promise<CommandResult> {
    console.log(`[ShellIntegrationExecutor] Using Shell Integration API (Cline Method + Interactive Detection)`);

    if (!terminal.shellIntegration) {
      throw new Error('Shell integration not available');
    }

    try {
      // Execute command with shell integration
      const execution = terminal.shellIntegration.executeCommand(command);
      const stream = execution.read();

      let fullOutput = '';
      let isFirstChunk = true;
      let lastOutputTime = Date.now();
      let noOutputDuration = 0;

      // Interactive prompt patterns (indicates command is waiting for user input)
      const interactivePromptPatterns = [
        /\?\s*$/,  // Question mark at end (e.g., "Continue? ")
        /:\s*$/,   // Colon at end (e.g., "Select: ")
        />\s*$/,   // Greater than at end (e.g., "> ")
        /\[.*\]\s*$/,  // Brackets at end (e.g., "[Y/n] ")
        /\(.*\)\s*$/,  // Parentheses at end (e.g., "(yes/no) ")
        /choose/i,  // "choose" keyword
        /select/i,  // "select" keyword
        /enter/i,   // "enter" keyword
        /proceed/i, // "proceed" keyword
        /cancel/i,  // "cancel" keyword
        /○/,        // Radio button (npm create vite uses this!)
        /◯/,        // Empty radio button
        /●/,        // Filled radio button
        /\[.*\]/,   // Checkbox patterns
      ];

      // Read stream with timeout detection for interactive prompts
      const streamReader = (async () => {
        for await (let data of stream) {
          // Process first chunk to remove terminal artifacts (like Cline does)
          if (isFirstChunk) {
            // Remove VSCode shell integration sequences (]633;C, ]633;D, etc.)
            const vscodeSequenceRegex = /\x1b\]633;.[^\x07]*\x07/g;
            const lastMatch = [...data.matchAll(vscodeSequenceRegex)].pop();
            if (lastMatch && lastMatch.index !== undefined) {
              data = data.slice(lastMatch.index + lastMatch[0].length);
            }

            // Remove ANSI escape codes
            data = this.stripAnsi(data);

            // Remove non-printable characters from first line
            const lines = data ? data.split('\n') : [];
            if (lines.length > 0) {
              lines[0] = lines[0].replace(/[^\x20-\x7E]/g, '');
            }

            // Check for duplicated first character (terminal artifact)
            if (
              lines.length > 0 &&
              lines[0].length >= 2 &&
              lines[0][0] === lines[0][1] &&
              !['[', '{', '"', "'", '<', '('].includes(lines[0][0])
            ) {
              lines[0] = lines[0].slice(1);
            }

            // Remove terminal prompt artifacts
            if (lines.length > 0) {
              lines[0] = lines[0].replace(/^[\x00-\x1F%$>#\s]*/, '');
            }

            data = lines.join('\n');
            isFirstChunk = false;
          } else {
            // Strip ANSI for subsequent chunks
            data = this.stripAnsi(data);
          }

          // Detect Ctrl+C (command terminated by user)
          if (data.includes('^C') || data.includes('\u0003')) {
            console.log(`[ShellIntegrationExecutor] Ctrl+C detected - command terminated by user`);
            break;
          }

          // Update last output time
          if (data.trim()) {
            lastOutputTime = Date.now();
          }

          // Accumulate output
          fullOutput += data;

          // Check if output indicates interactive prompt
          const looksLikeInteractivePrompt = interactivePromptPatterns.some(pattern =>
            pattern.test(fullOutput)
          );

          if (looksLikeInteractivePrompt) {
            console.log(`[ShellIntegrationExecutor] Interactive prompt detected in output`);
            console.log(`[ShellIntegrationExecutor] Last 200 chars: ${fullOutput.slice(-200)}`);
          }

          // Stream output to callback
          if (options.streamOutput !== false && data.trim()) {
            onChunk({
              type: 'stdout',
              data: data,
              timestamp: Date.now()
            });
          }
        }
      })();

      // Wait for stream to end OR detect interactive prompt with timeout
      const interactiveDetectionTimeout = 2000; // 2 seconds of no output = likely waiting for input

      while (true) {
        // Check if stream is done
        const streamDone = await Promise.race([
          streamReader.then(() => true),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))
        ]);

        if (streamDone) {
          console.log(`[ShellIntegrationExecutor] Stream ended naturally`);
          break;
        }

        // Check for interactive prompt with no output timeout
        noOutputDuration = Date.now() - lastOutputTime;

        if (noOutputDuration > interactiveDetectionTimeout && fullOutput.trim()) {
          // Check if output looks like an interactive prompt
          const looksLikeInteractivePrompt = interactivePromptPatterns.some(pattern =>
            pattern.test(fullOutput)
          );

          if (looksLikeInteractivePrompt) {
            console.log(`[ShellIntegrationExecutor] Interactive prompt detected (no output for ${noOutputDuration}ms)`);
            console.log(`[ShellIntegrationExecutor] Completing early to allow user interaction`);
            break;
          }
        }

        // Continue waiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Command is finished (or waiting for user input)!
      const duration = Date.now() - startTime;
      const exitCode = 0; // Stream completed successfully

      console.log(`[ShellIntegrationExecutor] Command completed`);
      console.log(`[ShellIntegrationExecutor] Duration: ${duration}ms`);
      console.log(`[ShellIntegrationExecutor] Output length: ${fullOutput.length} chars`);

      // Send completion chunk
      onChunk({
        type: 'complete',
        exitCode,
        duration,
        timestamp: Date.now()
      });

      // Cleanup
      this.activeExecutions.delete(commandId);
      this.activeTerminals.delete(commandId);
      this.outputCallbacks.delete(commandId);

      console.log(`[ShellIntegrationExecutor] Command completed. Terminal preserved for reuse.`);

      return {
        output: fullOutput,
        exitCode,
        duration,
        success: true
      };

    } catch (error) {
      console.error(`[ShellIntegrationExecutor] Error executing with shell integration:`, error);

      onChunk({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });

      throw error;
    }
  }

  /**
   * Strip ANSI escape codes from text
   */
  private stripAnsi(text: string): string {
    // ANSI escape code regex
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    return text.replace(ansiRegex, '');
  }

  /**
   * Execute a command with streaming output
   * Uses Cline's proven method: Shell Integration with fallback
   */
  async executeStreaming(
    commandId: string,
    command: string,
    options: ExecutionOptions,
    onChunk: (chunk: OutputChunk) => void
  ): Promise<CommandResult> {
    const startTime = Date.now();

    // Store callback for this command
    this.outputCallbacks.set(commandId, onChunk);

    // Determine working directory
    const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    // Check command type
    const isLongRunning = this.isLongRunningCommand(command);

    console.log(`[ShellIntegrationExecutor] Command is long-running: ${isLongRunning}`);

    // Send initial status
    onChunk({
      type: 'status',
      message: `Executing command...`,
      timestamp: Date.now()
    });

    console.log(`[ShellIntegrationExecutor] Executing command: ${command}`);
    console.log(`[ShellIntegrationExecutor] Working directory: ${cwd}`);

    try {
      // Get or create reusable terminal
      const terminal = this.getOrCreateTerminal(cwd, options.env);

      // Store terminal reference for this command
      this.activeTerminals.set(commandId, terminal);

      // Show terminal
      terminal.show(true); // preserveFocus = true

      // Change to correct working directory if needed
      if (cwd) {
        const cdCommand = process.platform === 'win32'
          ? `cd /d "${cwd}"`
          : `cd "${cwd}"`;
        terminal.sendText(cdCommand);

        // Wait a bit for cd to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // For long-running commands (dev servers), handle differently
      if (isLongRunning) {
        return await this.executeLongRunningCommand(commandId, command, terminal, options, onChunk, startTime);
      }

      // Try Shell Integration first (like Cline does)
      if (terminal.shellIntegration) {
        console.log(`[ShellIntegrationExecutor] Shell integration available - using Cline method`);
        return await this.executeWithShellIntegration(commandId, command, terminal, options, onChunk, startTime);
      }

      // Wait for shell integration to activate (Cline waits 4 seconds)
      console.log(`[ShellIntegrationExecutor] Waiting for shell integration (4 seconds)...`);
      const shellIntegrationTimeout = 4000;
      const waitStart = Date.now();

      while (!terminal.shellIntegration && (Date.now() - waitStart) < shellIntegrationTimeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      if (terminal.shellIntegration) {
        console.log(`[ShellIntegrationExecutor] Shell integration activated - using Cline method`);
        return await this.executeWithShellIntegration(commandId, command, terminal, options, onChunk, startTime);
      }

      // Fallback: No shell integration available
      console.log(`[ShellIntegrationExecutor] Shell integration not available - using fallback method`);
      return await this.executeLegacyMethod(commandId, command, terminal, options, onChunk, startTime);

    } catch (error) {
      console.error(`[ShellIntegrationExecutor] Failed to execute command:`, error);

      onChunk({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now()
      });

      // Cleanup
      this.activeExecutions.delete(commandId);
      this.activeTerminals.delete(commandId);
      this.outputCallbacks.delete(commandId);

      throw error;
    }
  }



  /**
   * Execute a long-running command (dev server, watch mode, etc.)
   * These commands don't exit normally, so we mark them as complete after startup
   * BUT we use child_process to monitor output for errors during startup
   */
  private async executeLongRunningCommand(
    commandId: string,
    command: string,
    terminal: vscode.Terminal,
    options: ExecutionOptions,
    onChunk: (chunk: OutputChunk) => void,
    startTime: number
  ): Promise<CommandResult> {
    console.log(`[ShellIntegrationExecutor] Executing long-running command with error monitoring`);

    return new Promise((resolve, reject) => {
      let terminalOutput = '';
      let hasError = false;
      let errorMessage = '';

      // Import child_process
      const { spawn } = require('child_process');

      // Determine shell and command
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/bash';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      // Determine working directory
      const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      // Spawn process to monitor output
      const childProcess = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...options.env },
        shell: false
      });

      // Monitor stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        const cleanData = this.stripAnsi(data.toString());
        terminalOutput += cleanData;

        // Stream to callback
        if (cleanData.trim()) {
          onChunk({
            type: 'stdout',
            data: cleanData,
            timestamp: Date.now()
          });
        }

        // Check for errors
        if (this.detectErrorInOutput(cleanData)) {
          hasError = true;
          if (!errorMessage) {
            errorMessage = this.extractErrorMessage(cleanData);
          }
        }
      });

      // Monitor stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        const cleanData = this.stripAnsi(data.toString());
        terminalOutput += cleanData;

        // Stream to callback
        if (cleanData.trim()) {
          onChunk({
            type: 'stderr',
            data: cleanData,
            timestamp: Date.now()
          });
        }

        // Check for errors
        if (this.detectErrorInOutput(cleanData)) {
          hasError = true;
          if (!errorMessage) {
            errorMessage = this.extractErrorMessage(cleanData);
          }
        }
      });

      // Also send command to terminal for user visibility
      terminal.sendText(command);

      // Wait for process to start and check for errors
      setTimeout(() => {
        const duration = Date.now() - startTime;

        if (hasError) {
          // Error detected - report failure
          console.log(`[ShellIntegrationExecutor] Long-running command failed with error`);

          onChunk({
            type: 'error',
            message: `Command failed during startup: ${errorMessage}`,
            timestamp: Date.now()
          });

          onChunk({
            type: 'complete',
            exitCode: 1,
            duration,
            timestamp: Date.now()
          });

          // Kill the child process
          childProcess.kill();

          // Cleanup references but keep terminal for user inspection
          this.activeExecutions.delete(commandId);
          this.activeTerminals.delete(commandId);
          this.outputCallbacks.delete(commandId);

          reject(new Error(`Command failed: ${errorMessage}`));
        } else {
          // No errors detected - mark as success
          console.log(`[ShellIntegrationExecutor] Long-running command started successfully (no errors detected)`);

          onChunk({
            type: 'complete',
            exitCode: 0,
            duration,
            timestamp: Date.now()
          });

          // Keep child process running in background
          // Cleanup references but keep terminal
          this.activeExecutions.delete(commandId);
          this.activeTerminals.delete(commandId);
          this.outputCallbacks.delete(commandId);

          resolve({
            output: terminalOutput || 'Long-running process started successfully',
            exitCode: 0,
            duration,
            success: true
          });
        }
      }, 5000); // Wait 5 seconds to give time for errors to appear
    });
  }

  /**
   * Detect if output contains error patterns
   */
  private detectErrorInOutput(data: string): boolean {
    const errorPatterns = [
      /\[vite\] Internal server error:/i,
      /Error: /i,
      /ERROR:/i,
      /Failed to /i,
      /Cannot find module/i,
      /SyntaxError:/i,
      /TypeError:/i,
      /ReferenceError:/i,
      /Module not found/i,
      /ENOENT:/i,
      /EADDRINUSE:/i,
      /npm ERR!/i,
      /yarn error/i,
      /pnpm ERR!/i,
      /\[postcss\]/i  // PostCSS errors like the Tailwind issue
    ];

    return errorPatterns.some(pattern => pattern.test(data));
  }

  /**
   * Extract error message from output
   */
  private extractErrorMessage(data: string): string {
    // Try to extract the first 500 characters containing the error
    const lines = data.split('\n');
    let errorLines: string[] = [];
    let foundError = false;

    for (const line of lines) {
      if (this.detectErrorInOutput(line)) {
        foundError = true;
      }
      if (foundError) {
        errorLines.push(line);
        if (errorLines.join('\n').length > 500) {
          break;
        }
      }
    }

    return errorLines.join('\n').substring(0, 500).trim();
  }

  private async executeLegacyMethod(
    commandId: string,
    command: string,
    terminal: vscode.Terminal,
    options: ExecutionOptions,
    onChunk: (chunk: OutputChunk) => void,
    startTime: number
  ): Promise<CommandResult> {
    console.log(`[ShellIntegrationExecutor] Using legacy execution method with process watcher`);

    const shellType = await this.getTerminalShellType(terminal);
    console.log(`[ShellIntegrationExecutor] Detected shell type: ${shellType}`);
    this.showFallbackNotification(shellType);

    // Notify webview about fallback mode
    if (this.webviewCommunicator) {
      this.webviewCommunicator.sendFallbackModeUsed(commandId, shellType);
    }

    return new Promise((resolve, reject) => {
      let fullOutput = '';
      const { spawn } = require('child_process');

      // Determine shell and command args for the watcher
      const isWindows = process.platform === 'win32';
      let shell = isWindows ? 'cmd.exe' : '/bin/bash';
      let shellArgs = isWindows ? ['/c', command] : ['-c', command];

      // If we specifically detected Git Bash on Windows, use it for the watcher too
      if (isWindows && shellType === 'Git Bash') {
        const gitBashPath = (terminal.creationOptions as vscode.TerminalOptions).shellPath;
        if (gitBashPath) {
          shell = gitBashPath;
          shellArgs = ['-c', command];
        }
      }

      const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();

      // Send command to VS Code terminal for user visibility
      terminal.sendText(command);

      // Spawn process to monitor real execution progress/exit
      const childProcess = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...options.env },
        shell: false
      });

      // Safety timeout: 5 minutes
      const safetyTimeout = 5 * 60 * 1000;
      const timeoutHandle = setTimeout(() => {
        console.log(`[ShellIntegrationExecutor] Safety timeout reached (5m) - killing process`);
        childProcess.kill();
        reject(new Error('Command timed out after 5 minutes'));
      }, safetyTimeout);

      childProcess.stdout?.on('data', (data: Buffer) => {
        const cleanData = this.stripAnsi(data.toString());
        fullOutput += cleanData;
        onChunk({
          type: 'stdout',
          data: cleanData,
          timestamp: Date.now()
        });
      });

      childProcess.stderr?.on('data', (data: Buffer) => {
        const cleanData = this.stripAnsi(data.toString());
        fullOutput += cleanData;
        onChunk({
          type: 'stderr',
          data: cleanData,
          timestamp: Date.now()
        });
      });

      childProcess.on('close', (code: number) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        console.log(`[ShellIntegrationExecutor] Process watcher finished with code ${code}`);

        onChunk({
          type: 'complete',
          exitCode: code,
          duration,
          timestamp: Date.now()
        });

        // Cleanup
        this.activeExecutions.delete(commandId);
        this.activeTerminals.delete(commandId);
        this.outputCallbacks.delete(commandId);

        resolve({
          output: fullOutput,
          exitCode: code,
          duration,
          success: code === 0
        });
      });

      childProcess.on('error', (err: Error) => {
        clearTimeout(timeoutHandle);
        console.error(`[ShellIntegrationExecutor] Process watcher error:`, err);
        reject(err);
      });

      // Store disposables
      this.activeExecutions.set(commandId, {
        dispose: () => {
          clearTimeout(timeoutHandle);
          if (childProcess.exitCode === null) {
            childProcess.kill();
          }
        }
      } as vscode.Disposable);
    });
  }

  /**
   * Kill a running command
   */
  killCommand(commandId: string): boolean {
    const disposable = this.activeExecutions.get(commandId);
    let killed = false;

    if (disposable) {
      console.log(`[ShellIntegrationExecutor] Killing command: ${commandId}`);
      disposable.dispose();
      this.activeExecutions.delete(commandId);
      killed = true;
    }

    // Don't dispose the terminal - it's reusable
    this.activeTerminals.delete(commandId);
    this.outputCallbacks.delete(commandId);

    if (killed) {
      console.log(`[ShellIntegrationExecutor] Command ${commandId} killed. Terminal preserved for reuse.`);
    }
    
    return killed;
  }

  /**
   * Get all active command IDs
   */
  getActiveCommands(): string[] {
    return Array.from(this.activeExecutions.keys());
  }

  /**
   * Check if a command is currently running
   */
  isCommandRunning(commandId: string): boolean {
    return this.activeExecutions.has(commandId);
  }

  /**
   * Cleanup all active executions and terminals
   */
  dispose(): void {
    console.log(`[ShellIntegrationExecutor] Disposing all executions(${this.activeExecutions.size})`);

    for (const disposable of this.activeExecutions.values()) {
      disposable.dispose();
    }
    this.activeExecutions.clear();

    // Don't dispose terminals - they are reusable and managed by VS Code
    // Only clear our references
    this.activeTerminals.clear();
    this.outputCallbacks.clear();

    // Note: We intentionally keep this.reusableTerminal alive
    // It will be reused for future commands
    console.log(`[ShellIntegrationExecutor] Cleanup complete.Reusable terminal preserved.`);
  }
}
