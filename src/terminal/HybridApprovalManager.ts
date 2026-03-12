import * as vscode from 'vscode';

/**
 * Terminal execution mode
 */
export type TerminalMode = 'manual' | 'smart';

/**
 * Safety level for commands
 */
export type SafetyLevel = 'safe' | 'moderate' | 'risky';

/**
 * Command evaluation result
 */
export interface CommandEvaluation {
  safetyLevel: SafetyLevel;
  requiresApproval: boolean;
  reason: string;
  matchedPattern?: string;
}

/**
 * Quick-approve pattern
 */
export interface QuickPattern {
  name: string;
  pattern: RegExp;
  icon: string;
  enabled: boolean;
}

/**
 * Approval request
 */
export interface ApprovalRequest {
  commandId: string;
  command: string;
  cwd: string;
  reason: string;
  safetyLevel: SafetyLevel;
  timestamp: number;
}

/**
 * Approval response types
 */
export type ApprovalResponse = 'accept' | 'accept_always' | 'deny';

/**
 * Hybrid Approval Manager
 * Manages command approval with smart pattern-matching and safety evaluation
 */
export class HybridApprovalManager {
  private mode: TerminalMode = 'manual';
  private quickPatterns: QuickPattern[] = [
    {
      name: 'npm',
      pattern: /^npm\s+(install|i|test|run|start|build|ci|audit|outdated|list|ls|view|info|search|doctor|cache|config|init|version|help|publish|pack|deprecate|dist-tag|owner|team|access|profile)\b/,
      icon: '📦',
      enabled: true
    },
    {
      name: 'yarn',
      pattern: /^yarn\s+(install|add|test|run|start|build|audit|outdated|list|info|cache|config|init|version|help|publish|pack|workspace|workspaces|v2|dlx)\b/,
      icon: '🧶',
      enabled: true
    },
    {
      name: 'pnpm',
      pattern: /^pnpm\s+(install|i|test|run|start|build|audit|outdated|list|ls|info|cache|config|init|version|help|publish|pack|recursive|m|multi|filter|exec|dlx)\b/,
      icon: '⚡',
      enabled: true
    },
    {
      name: 'git',
      pattern: /^git\s+(status|log|diff|show|branch|checkout|fetch|pull|add|commit|stash|tag|remote|config|help|rebase|merge|cherry-pick|revert|reset\s+--soft|grep|blame|archive|ls-files|rev-parse)\b/,
      icon: '🔀',
      enabled: true
    },
    {
      name: 'cargo',
      pattern: /^cargo\s+(check|test|build|run|doc|clippy|fmt|tree|search|help|update|publish|package|install|uninstall|metadata|vendor|verify-project)\b/,
      icon: '🦀',
      enabled: true
    },
    {
      name: 'pytest',
      pattern: /^pytest\b/,
      icon: '🧪',
      enabled: true
    },
    {
      name: 'jest',
      pattern: /^(jest|npm\s+test|yarn\s+test|pnpm\s+test|npx\s+jest)\b/,
      icon: '🃏',
      enabled: true
    },
    {
      name: 'tsc',
      pattern: /^(tsc|npx\s+tsc)\s+(--noEmit|--build|--watch|--help|--init|--project|--version)\b/,
      icon: '📘',
      enabled: true
    }
  ];

  private pendingApprovals: Map<string, {
    resolve: (approved: boolean) => void;
    reject: (error: Error) => void;
    command: string;
  }> = new Map();

  constructor(
    private context: vscode.ExtensionContext,
    private sendMessageToWebview: (message: any) => void
  ) {
    // Load saved mode from settings
    this.loadSettings();
  }

  /**
   * Load settings from VS Code configuration
   */
  private loadSettings(): void {
    const config = vscode.workspace.getConfiguration('gently.terminal');
    this.mode = config.get<TerminalMode>('mode', 'manual');

    // Load dynamic patterns if any (could be stored in globalState)
    const savedPatterns = this.context.globalState.get<any[]>('gently.terminal.dynamicPatterns', []);
    for (const p of savedPatterns) {
      this.quickPatterns.push({
        ...p,
        pattern: new RegExp(p.patternString)
      });
    }

    console.log(`[HybridApprovalManager] Loaded mode: ${this.mode}`);
  }

  /**
   * Set terminal mode
   */
  setMode(mode: TerminalMode): void {
    this.mode = mode;

    // Save to settings
    const config = vscode.workspace.getConfiguration('gently.terminal');
    config.update('mode', mode, vscode.ConfigurationTarget.Global);

    console.log(`[HybridApprovalManager] Mode changed to: ${mode}`);
  }

  /**
   * Get current mode
   */
  getMode(): TerminalMode {
    return this.mode;
  }

  /**
   * Get quick patterns
   */
  getQuickPatterns(): QuickPattern[] {
    return this.quickPatterns;
  }

  /**
   * Toggle quick pattern
   */
  toggleQuickPattern(name: string, enabled: boolean): void {
    const pattern = this.quickPatterns.find(p => p.name === name);
    if (pattern) {
      pattern.enabled = enabled;
      console.log(`[HybridApprovalManager] Pattern ${name} ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Add a dynamic quick pattern based on a command
   */
  private addDynamicQuickPattern(command: string): void {
    const trimmed = command.trim();
    // Try to extract base command (e.g. "npm install something" -> "npm install")
    const words = trimmed.split(/\s+/);
    let base = words[0];
    if (words.length > 1 && ['npm', 'pnpm', 'yarn', 'git', 'cargo'].includes(words[0])) {
      base = `${words[0]} ${words[1]}`;
    }

    // Check if already exists
    if (this.quickPatterns.some(p => p.name === base)) return;

    const patternString = `^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    const newPattern: QuickPattern = {
      name: base,
      pattern: new RegExp(patternString),
      icon: '🛡️',
      enabled: true
    };

    this.quickPatterns.push(newPattern);

    // Persist to global state
    const saved = this.context.globalState.get<any[]>('gently.terminal.dynamicPatterns', []);
    saved.push({
      name: base,
      patternString,
      icon: '🛡️',
      enabled: true
    });
    this.context.globalState.update('gently.terminal.dynamicPatterns', saved);

    console.log(`[HybridApprovalManager] Added dynamic quick pattern: ${base}`);
  }

  /**
   * Evaluate command safety
   */
  evaluateCommandSafety(command: string): CommandEvaluation {
    const cmd = command.trim().toLowerCase();

    // ── Explicitly safe commands (package managers, build tools, etc.) ──
    const safePatterns = [
      /^(npm|pnpm|yarn|bun)\s+(install|i|ci|test|t|run|start|build|audit|outdated|list|ls|view|info|search|doctor|cache|config|init|version|help|publish|pack|deprecate|dist-tag|owner|team|access|profile)\b/,
      /^(npx|bunx)\s+/,
      /^tsc\b/,
      /^node\s+/,
      /^cat\s+/,
      /^echo\s+/,
      /^ls\b/,
      /^dir\b/,
      /^pwd\b/,
      /^which\b/,
      /^type\b/,
      /^git\s+(status|log|diff|show|branch|checkout|fetch|pull|add|commit|stash|tag|remote|config|help|rebase|merge|cherry-pick|revert|reset\s+--soft|grep|blame|archive|ls-files|rev-parse)\b/,
      /^cargo\s+(check|test|build|run|doc|clippy|fmt|tree|search|help|update|publish|package|install|uninstall|metadata|vendor|verify-project)\b/
    ];

    for (const pattern of safePatterns) {
      if (pattern.test(cmd)) {
        return {
          safetyLevel: 'safe',
          requiresApproval: false,
          reason: 'Known safe command',
          matchedPattern: pattern.source
        };
      }
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /rm\s+-rf\s+\//,  // rm -rf /
      /sudo\s+rm/,      // sudo rm
      /format\s+[a-z]:/i, // format C:
      /del\s+\/[sf]/i,  // del /s /f
      /:\(\)\{\s*:\|:&\s*\};:/  // Fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(cmd)) {
        return {
          safetyLevel: 'risky',
          requiresApproval: true,
          reason: 'Potentially destructive command detected'
        };
      }
    }

    // Check for system-wide changes
    const systemPatterns = [
      /^sudo\s+/,
      /^su\s+/,
      /^chmod\s+/,
      /^chown\s+/,
      /^systemctl\s+/,
      /^service\s+/
    ];

    for (const pattern of systemPatterns) {
      if (pattern.test(cmd)) {
        return {
          safetyLevel: 'moderate',
          requiresApproval: true,
          reason: 'System-wide changes require approval'
        };
      }
    }

    // Check for write operations
    const writePatterns = [
      /^(rm|del|erase)\s+/,
      /^(mv|move|ren|rename)\s+/,
      /^(cp|copy)\s+/,
      /^(mkdir|md)\s+/,
      /^(rmdir|rd)\s+/,
      />\s*[^&]/  // Output redirection
    ];

    for (const pattern of writePatterns) {
      if (pattern.test(cmd)) {
        return {
          safetyLevel: 'moderate',
          requiresApproval: true,
          reason: 'File system modifications require approval'
        };
      }
    }

    // Default: safe read-only command
    return {
      safetyLevel: 'safe',
      requiresApproval: false,
      reason: 'Read-only command'
    };
  }

  /**
   * Check if command matches quick-approve patterns
   */
  private matchesQuickPattern(command: string): QuickPattern | undefined {
    return this.quickPatterns.find(
      pattern => pattern.enabled && pattern.pattern.test(command.trim())
    );
  }

  /**
   * Request approval for a command
   */
  async requestApproval(request: ApprovalRequest): Promise<boolean> {
    console.log(`[HybridApprovalManager] Requesting approval for: ${request.command}`);
    console.log(`[HybridApprovalManager] Mode: ${this.mode}, Safety: ${request.safetyLevel}`);

    // Manual mode: always require approval
    if (this.mode === 'manual') {
      return this.showApprovalDialog(request);
    }

    // Smart Auto mode: check patterns and safety
    if (this.mode === 'smart') {
      // Check quick-approve patterns
      const matchedPattern = this.matchesQuickPattern(request.command);
      if (matchedPattern) {
        console.log(`[HybridApprovalManager] Auto-approved via pattern: ${matchedPattern.name}`);
        return true;
      }

      // Evaluate safety
      const evaluation = this.evaluateCommandSafety(request.command);

      if (evaluation.safetyLevel === 'safe') {
        console.log(`[HybridApprovalManager] Auto-approved as safe command`);
        return true;
      }

      // Risky or moderate: require approval
      return this.showApprovalDialog(request);
    }

    // Default: require approval
    return this.showApprovalDialog(request);
  }

  /**
   * Show approval dialog in webview
   */
  private async showApprovalDialog(request: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve, reject) => {
      // Store promise handlers
      this.pendingApprovals.set(request.commandId, { resolve, reject, command: request.command });

      // Send approval request to webview (must match ChatView.svelte handler)
      this.sendMessageToWebview({
        type: 'commandApprovalRequest',
        request,
        buttons: ['Accept', 'Accept always', 'Deny'],
        timestamp: Date.now()
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pendingApprovals.has(request.commandId)) {
          this.pendingApprovals.delete(request.commandId);
          reject(new Error('Approval request timeout'));
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Handle approval response from webview
   */
  handleApprovalResponse(commandId: string, response: ApprovalResponse): void {
    const handlers = this.pendingApprovals.get(commandId);

    if (handlers) {
      console.log(`[HybridApprovalManager] Approval response for ${commandId}: ${response}`);

      if (response === 'accept_always') {
        this.addDynamicQuickPattern(handlers.command);
      }

      handlers.resolve(response !== 'deny');
      this.pendingApprovals.delete(commandId);
    } else {
      console.warn(`[HybridApprovalManager] No pending approval for ${commandId}`);
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    // Reject all pending approvals
    for (const [commandId, handlers] of this.pendingApprovals.entries()) {
      handlers.reject(new Error('Approval manager disposed'));
    }
    this.pendingApprovals.clear();
  }
}

