import * as vscode from 'vscode';
import { 
  TerminalMode, 
  ApprovalRequest, 
  QuickPattern, 
  CommandEvaluation,
  AutoApprovalActions,
  CommandApprovalResolveReason
} from '../types/approval';
import { DiagnosticService } from '../services/DiagnosticService';
import { LogService } from '../services/LogService';
import {
  PermissionDecisionReason,
  evaluateToolPermissionDecision,
  resolveToolPolicyAction
} from './PermissionPolicy';

const approvalLog = new LogService('ApprovalManager');

export class ApprovalManager {
  private static readonly APPROVAL_TIMEOUT_MS = 90_000;
  private static readonly SAFE_PREFIXES = [
    'pwd',
    'ls',
    'dir',
    'echo',
    'cat',
    'type',
    'git status',
    'git diff',
    'git log',
    'npm test',
    'npm run test'
  ];
  private static readonly RISKY_PATTERNS: RegExp[] = [
    /\brm\s+-rf\b/i,
    /\bdel\s+\/f\b/i,
    /\bformat\s+\w+:?\s*\/fs/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bcurl\b.*\|\s*(sh|bash|pwsh|powershell)/i,
    /\bInvoke-Expression\b/i,
    /\bIEX\b/i
  ];

  private mode: TerminalMode = 'manual';
  private quickPatterns: QuickPattern[] = [
    { name: 'git-status', pattern: '^git\\s+status(\\s|$)', enabled: true },
    { name: 'git-diff', pattern: '^git\\s+diff(\\s|$)', enabled: true },
    { name: 'npm-test', pattern: '^npm\\s+(run\\s+)?test(\\s|$)', enabled: true }
  ];
  private pendingApprovals = new Map<
    string,
    {
      resolve: (approved: boolean) => void;
      timeoutHandle: ReturnType<typeof setTimeout>;
      settled: boolean;
    }
  >();

  constructor(
    private context: vscode.ExtensionContext,
    private sendMessageToWebview: (message: { type: string; [key: string]: unknown }) => void
  ) {
    approvalLog.info('Initialized');
  }

  public evaluateCommandSafety(command: string): CommandEvaluation {
    const normalized = String(command || '').trim().toLowerCase();
    if (!normalized) {
      return {
        safetyLevel: 'risky',
        reason: 'Empty command'
      };
    }

    for (const pattern of ApprovalManager.RISKY_PATTERNS) {
      if (pattern.test(command)) {
        return {
          safetyLevel: 'risky',
          reason: 'Matches risky command pattern'
        };
      }
    }

    const isSafePrefix = ApprovalManager.SAFE_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
    if (isSafePrefix) {
      return {
        safetyLevel: 'safe',
        reason: 'Matches approved safe command prefix'
      };
    }

    const hasCommandSeparator = /[;&|]/.test(command);
    if (hasCommandSeparator) {
      return {
        safetyLevel: 'risky',
        reason: 'Contains shell command chaining'
      };
    }

    const likelyMutating = /\b(git\s+(commit|push|reset|clean)|npm\s+install|pnpm\s+install|bun\s+install|mv|move|copy|cp|mkdir|touch)\b/i.test(command);
    if (likelyMutating) {
      return {
        safetyLevel: 'moderate',
        reason: 'Potentially mutating command'
      };
    }

    return {
      safetyLevel: 'moderate',
      reason: 'Unknown command profile'
    };
  }

  public async requestApproval(request: ApprovalRequest): Promise<boolean> {
    approvalLog.info('COMMAND_APPROVAL_REQUESTED', {
      commandId: request.commandId,
      command: request.command,
      cwd: request.cwd
    });
    const evaluation = this.evaluateCommandSafety(request.command);
    const now = Date.now();
    const timeoutMs = ApprovalManager.APPROVAL_TIMEOUT_MS;
    const expiresAt = now + timeoutMs;
    const normalizedRequest: ApprovalRequest = {
      ...request,
      safetyLevel: request.safetyLevel || evaluation.safetyLevel,
      timeoutMs,
      expiresAt
    };

    if (this.mode === 'auto') {
      return true;
    }
    if (this.mode === 'smart' && normalizedRequest.safetyLevel === 'safe') {
      return true;
    }
    if (this.matchesQuickPattern(normalizedRequest.command)) {
      return true;
    }

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.resolvePendingApproval(
          normalizedRequest.commandId,
          false,
          'approval_timeout',
          'system'
        );
      }, timeoutMs);

      this.pendingApprovals.set(normalizedRequest.commandId, {
        resolve,
        timeoutHandle,
        settled: false
      });

      this.sendMessageToWebview({
        type: 'approvalRequest',
        request: normalizedRequest,
        timestamp: now
      });
    });
  }

  public handleApprovalResponse(commandId: string, response: unknown): void {
    const normalizedResponse = this.normalizeApprovalResponse(response);
    if (!normalizedResponse) {
      this.resolvePendingApproval(commandId, false, 'invalid_response', 'system');
      return;
    }
    const approved = normalizedResponse === 'accept' || normalizedResponse === 'accept_always';
    this.resolvePendingApproval(
      commandId,
      approved,
      approved ? 'approved' : 'rejected_by_user',
      'user'
    );
  }

  public setMode(mode: TerminalMode): void {
    this.mode = mode;
  }

  public getMode(): TerminalMode {
    return this.mode;
  }

  public getQuickPatterns(): QuickPattern[] {
    return this.quickPatterns;
  }

  public toggleQuickPattern(name: string, enabled: boolean): void {
    const pattern = this.quickPatterns.find(p => p.name === name);
    if (pattern) {
      pattern.enabled = enabled;
    }
  }

  public dispose(): void {
    for (const [commandId, pending] of this.pendingApprovals.entries()) {
      clearTimeout(pending.timeoutHandle);
      if (!pending.settled) {
        pending.settled = true;
        pending.resolve(false);
        this.emitCommandApprovalResolved(commandId, 'rejected', 'aborted_by_shutdown', 'system');
      }
      this.pendingApprovals.delete(commandId);
    }
  }

  private normalizeApprovalResponse(response: unknown): 'accept' | 'accept_always' | 'deny' | null {
    if (response === true) return 'accept';
    if (typeof response !== 'string') return null;
    const normalized = response.trim().toLowerCase();
    if (normalized === 'accept' || normalized === 'accept_always' || normalized === 'deny') {
      return normalized;
    }
    return null;
  }

  private resolvePendingApproval(
    commandId: string,
    approved: boolean,
    reason: CommandApprovalResolveReason,
    source: 'user' | 'system'
  ): void {
    const pending = this.pendingApprovals.get(commandId);
    if (!pending || pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timeoutHandle);
    this.pendingApprovals.delete(commandId);
    pending.resolve(approved);

    this.emitCommandApprovalResolved(commandId, approved ? 'approved' : 'rejected', reason, source);
    approvalLog.info('COMMAND_APPROVAL_RESOLVED', {
      commandId,
      status: approved ? 'approved' : 'rejected',
      reason,
      source
    });
  }

  private emitCommandApprovalResolved(
    commandId: string,
    status: 'approved' | 'rejected',
    reason: CommandApprovalResolveReason,
    source: 'user' | 'system'
  ): void {
    this.sendMessageToWebview({
      type: 'commandApprovalResolved',
      commandId,
      status,
      reason,
      source,
      timestamp: Date.now()
    });
  }

  private matchesQuickPattern(command: string): boolean {
    return this.quickPatterns.some((pattern) => {
      if (!pattern.enabled) return false;
      try {
        return new RegExp(pattern.pattern, 'i').test(command);
      } catch {
        return false;
      }
    });
  }
}

/**
 * Alias for HybridApprovalManager for backward compatibility during cleanup
 */
export const HybridApprovalManager = ApprovalManager;

/**
 * Auto-approval policy manager for tool execution.
 */
export class AutoApproveManager {
  private static readonly STORAGE_KEY = 'gently.autoApproveSettings';
  private settings: import('../types/approval').AutoApprovalSettings;
  private readonly debugDecisions = false;

  constructor(private context: vscode.ExtensionContext) {
    this.settings = this.loadSettings();
  }

  public async shouldAutoApprove(toolName: string, params: unknown): Promise<boolean> {
    const decision = evaluateToolPermissionDecision(
      toolName,
      params,
      this.settings,
      this.getWorkspaceRoots()
    );

    if (decision.reason === 'unknown_tool') {
      console.warn(`[AutoApproveManager] Unknown tool "${toolName}" - requiring explicit approval.`);
      DiagnosticService.getInstance()?.recordUnknownEvent({
        kind: 'tool',
        origin: 'auto_approve_manager',
        rawType: decision.normalizedToolName,
        correlationId: `unknown:tool:${decision.normalizedToolName}`,
        payload: {
          toolName: decision.normalizedToolName
        }
      });
    }
    this.logDecision(toolName, decision.policyAction, decision.reason, decision.approved);
    return decision.approved;
  }

  public addAutoApproval(toolName: string): void {
    const action = resolveToolPolicyAction(toolName, {}, this.getWorkspaceRoots()).action;
    if (!action) {
      console.log(`[AutoApproveManager] No auto-approval mapping found for tool: ${toolName}`);
      return;
    }

    this.settings = {
      ...this.settings,
      version: this.settings.version + 1,
      actions: {
        ...this.settings.actions,
        [action]: true,
      },
    };

    void this.persistSettings();
  }

  public getSettings() {
    return this.settings;
  }

  public async setSettings(settings: import('../types/approval').AutoApprovalSettings): Promise<void> {
    this.settings = this.normalizeSettings(settings);
    await this.persistSettings();
  }

  private loadSettings(): import('../types/approval').AutoApprovalSettings {
    const stored = this.context.globalState.get<import('../types/approval').AutoApprovalSettings>(
      AutoApproveManager.STORAGE_KEY
    );
    return this.normalizeSettings(stored);
  }

  private normalizeSettings(
    settings?: Partial<import('../types/approval').AutoApprovalSettings>
  ): import('../types/approval').AutoApprovalSettings {
    return {
      version: settings?.version ?? 0,
      actions: {
        readFiles: settings?.actions?.readFiles ?? false,
        readFilesExternally: settings?.actions?.readFilesExternally ?? false,
        editFiles: settings?.actions?.editFiles ?? false,
        editFilesExternally: settings?.actions?.editFilesExternally ?? false,
        executeSafeCommands: settings?.actions?.executeSafeCommands ?? false,
        executeAllCommands: settings?.actions?.executeAllCommands ?? false,
        useBrowser: settings?.actions?.useBrowser ?? false,
        useMcp: settings?.actions?.useMcp ?? false,
      },
      enableNotifications: settings?.enableNotifications ?? true,
      yoloMode: settings?.yoloMode ?? false,
    };
  }

  private async persistSettings(): Promise<void> {
    await this.context.globalState.update(AutoApproveManager.STORAGE_KEY, this.settings);
  }

  private getWorkspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri.fsPath)
      .filter((rootPath) => typeof rootPath === 'string' && rootPath.trim().length > 0);
  }

  private logDecision(
    toolName: string,
    policy: keyof AutoApprovalActions | null,
    reason: PermissionDecisionReason,
    approved: boolean
  ): void {
    if (!this.debugDecisions) {
      return;
    }
    console.log(
      `[AutoApproveManager] Decision: tool=${toolName}, policy=${policy || 'none'}, reason=${reason}, approved=${approved}`
    );
  }
}
