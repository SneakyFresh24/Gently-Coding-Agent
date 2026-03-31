import * as vscode from 'vscode';
import { ShadowCheckpointStore } from './ShadowCheckpointStore';
import {
  CheckpointDiffResult,
  CheckpointRecord,
  CheckpointStats,
  RestoreOptions,
  RestoreResult,
  SerializedCheckpoint
} from './types';
import { HistoryManager, SessionType } from '../../services/HistoryManager';

export class CheckpointManager {
  private readonly storageKey = 'gently.checkpoints';
  private readonly migrationFlagKey = 'gently.checkpoints.migrated.v1';
  private currentSessionId: string | null = null;
  private sessionCounters: Map<string, number> = new Map();
  private readonly sessionCountersKey = 'gently.sessionCheckpointCounters';
  private sessionManager?: HistoryManager;
  private readonly shadowStore: ShadowCheckpointStore;

  constructor(private readonly context: vscode.ExtensionContext) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      throw new Error('No workspace folder open');
    }
    this.shadowStore = new ShadowCheckpointStore(context, workspaceRoot);
    this.loadSessionCounters();
  }

  setSessionManager(sessionManager: HistoryManager): void {
    this.sessionManager = sessionManager;
  }

  setCurrentSession(sessionId: string): void {
    this.currentSessionId = sessionId;
    if (!this.sessionCounters.has(sessionId)) this.sessionCounters.set(sessionId, 0);
  }

  async resetSessionCounter(sessionId: string): Promise<void> {
    this.sessionCounters.set(sessionId, 0);
    await this.saveSessionCounters();
  }

  async createCheckpoint(
    messageId: string,
    description: string,
    filePaths: string[],
    sessionId?: string
  ): Promise<CheckpointRecord> {
    await this.ensureLegacyMigrated();
    const effectiveSessionId = sessionId || this.currentSessionId || 'default-session';
    const currentCounter = this.sessionCounters.get(effectiveSessionId) || 0;
    const checkpointNumber = currentCounter + 1;
    this.sessionCounters.set(effectiveSessionId, checkpointNumber);
    await this.saveSessionCounters();

    return this.shadowStore.createCheckpoint({
      messageId,
      sessionId: effectiveSessionId,
      checkpointNumber,
      description,
      metadata: {
        filesChanged: Array.isArray(filePaths) ? filePaths.length : 0,
        totalSize: 0
      }
    });
  }

  async createCheckpointAfterStep(planId: string, stepId: string, stepResult: any): Promise<CheckpointRecord> {
    const description = `Snapshot after plan ${planId} step ${stepId}`;
    let changedFiles: string[] = [];
    if (stepResult && typeof stepResult === 'object') {
      if (Array.isArray(stepResult.changedFiles)) {
        changedFiles = stepResult.changedFiles;
      } else if (stepResult.path) {
        changedFiles = [stepResult.path];
      }
    }
    return this.createCheckpoint(`plan-${planId}-step-${stepId}`, description, changedFiles);
  }

  async restoreCheckpoint(checkpointId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    await this.ensureLegacyMigrated();
    const result = await this.shadowStore.restoreCheckpoint(checkpointId, options);
    if ((options.mode === 'task' || options.mode === 'files&task') && !options.pruneHistory && result.success) {
      const sessionPruned = await this.pruneActiveSessionByMessageId(checkpointId);
      if (sessionPruned > 0) {
        result.messagesPruned = (result.messagesPruned || 0) + sessionPruned;
      }
    }
    return result;
  }

  async getDiffSet(fromCheckpointId: string, toCheckpointId?: string): Promise<CheckpointDiffResult> {
    await this.ensureLegacyMigrated();
    return this.shadowStore.getDiffSet(fromCheckpointId, toCheckpointId);
  }

  async getCheckpointForMessage(messageId: string): Promise<CheckpointRecord | undefined> {
    const checkpoints = await this.getCheckpointsForMessage(messageId);
    return checkpoints[0];
  }

  async getCheckpointsForMessage(messageId: string): Promise<CheckpointRecord[]> {
    const checkpoints = await this.getAllCheckpoints();
    return checkpoints.filter((cp) => cp.messageId === messageId);
  }

  async getAllCheckpoints(): Promise<CheckpointRecord[]> {
    await this.ensureLegacyMigrated();
    return this.shadowStore.listCheckpoints();
  }

  async deleteCheckpoint(_checkpointId: string): Promise<boolean> {
    // Commit history is append-only in shadow git.
    return false;
  }

  async getStats(): Promise<CheckpointStats> {
    const checkpoints = await this.getAllCheckpoints();
    const totalSize = checkpoints.reduce((sum, cp) => sum + cp.metadata.totalSize, 0);
    return {
      totalCheckpoints: checkpoints.length,
      totalFilesTracked: checkpoints.reduce((sum, cp) => sum + cp.metadata.filesChanged, 0),
      totalSize,
      oldestCheckpoint: checkpoints.length > 0 ? new Date(checkpoints[checkpoints.length - 1].timestamp) : undefined,
      newestCheckpoint: checkpoints.length > 0 ? new Date(checkpoints[0].timestamp) : undefined
    };
  }

  async clearAll(): Promise<void> {
    await this.context.globalState.update(this.migrationFlagKey, false);
  }

  dispose(): void {
    this.sessionCounters.clear();
  }

  private async pruneActiveSessionByMessageId(checkpointId: string): Promise<number> {
    if (!this.sessionManager) return 0;
    const checkpoint = await this.shadowStore.getCheckpoint(checkpointId);
    if (!checkpoint) return 0;

    const active = await this.sessionManager.getActiveSession(SessionType.CHAT);
    if (!active) return 0;
    const messages = Array.isArray(active.messages) ? active.messages : [];
    const idx = messages.findIndex((m: any) => m?.id === checkpoint.messageId);
    if (idx < 0) return 0;

    const retained = messages.slice(0, idx + 1);
    const pruned = Math.max(0, messages.length - retained.length);
    if (pruned > 0) {
      await this.sessionManager.updateSession(active.id, { messages: retained });
    }
    return pruned;
  }

  private async ensureLegacyMigrated(): Promise<void> {
    const alreadyMigrated = this.context.globalState.get<boolean>(this.migrationFlagKey, false);
    if (alreadyMigrated) return;
    const legacy = this.context.globalState.get<SerializedCheckpoint[]>(this.storageKey, []);
    if (Array.isArray(legacy) && legacy.length > 0) {
      await this.shadowStore.migrateLegacyCheckpoints(legacy);
      await this.context.globalState.update(this.storageKey, []);
    }
    await this.context.globalState.update(this.migrationFlagKey, true);
  }

  private async loadSessionCounters(): Promise<void> {
    try {
      const stored = this.context.globalState.get<Record<string, number>>(this.sessionCountersKey, {});
      this.sessionCounters = new Map(Object.entries(stored));
    } catch {
      this.sessionCounters = new Map();
    }
  }

  private async saveSessionCounters(): Promise<void> {
    const toStore = Object.fromEntries(this.sessionCounters);
    await this.context.globalState.update(this.sessionCountersKey, toStore);
  }
}
