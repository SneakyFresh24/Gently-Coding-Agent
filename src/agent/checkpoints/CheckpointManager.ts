/**
 * CheckpointManager - Message-Based Checkpoint System
 * 
 * Inspired by Augment Code's checkpoint feature
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MessageCheckpoint, FileSnapshot, CheckpointMetadata, RestoreResult, CheckpointStats, SerializedCheckpoint } from './types';
import { GitDiffService } from '../GitDiffService';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class CheckpointManager {
  private checkpoints: Map<string, MessageCheckpoint> = new Map();
  private readonly maxCheckpoints = 50;
  private readonly storageKey = 'gently.checkpoints';
  private sessionCounters: Map<string, number> = new Map();
  private currentSessionId: string | null = null;
  private readonly sessionCountersKey = 'gently.sessionCheckpointCounters';

  constructor(
    private context: vscode.ExtensionContext,
    private gitDiffService: GitDiffService
  ) {
    this.loadCheckpoints();
    this.loadSessionCounters();
  }

  setCurrentSession(sessionId: string) {
    this.currentSessionId = sessionId;
    if (!this.sessionCounters.has(sessionId)) this.sessionCounters.set(sessionId, 0);
  }

  resetSessionCounter(sessionId: string) {
    this.sessionCounters.set(sessionId, 0);
    this.saveSessionCounters();
  }

  async createCheckpoint(
    messageId: string,
    description: string,
    filePaths: string[],
    sessionId?: string
  ): Promise<MessageCheckpoint> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) throw new Error('No workspace folder open');

    const effectiveSessionId = sessionId || this.currentSessionId || 'default-session';

    if (!this.sessionCounters.has(effectiveSessionId)) {
      this.sessionCounters.set(effectiveSessionId, 0);
    }

    const files = new Map<string, FileSnapshot>();
    let totalSize = 0;

    for (const filePath of filePaths) {
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);

      try {
        const exists = await this.fileExists(absolutePath);
        let content: string | undefined;
        let diff: string | undefined;
        let isGitTracked = false;

        if (exists) {
          isGitTracked = await this.gitDiffService.isTracked(filePath).catch(() => false);

          if (isGitTracked) {
            try {
              diff = await this.gitDiffService.getFileDiffContent(filePath);
            } catch {
              // Fallback to full content
              content = await fs.readFile(absolutePath, 'utf-8');
              isGitTracked = false;
            }
          } else {
            content = await fs.readFile(absolutePath, 'utf-8');
          }
        }

        files.set(filePath, { path: filePath, content, diff, exists, isGitTracked });

        totalSize += Buffer.byteLength(content || diff || '', 'utf-8');
      } catch (error) {
        console.error(`[Checkpoint] Snapshot failed for ${filePath}:`, error);
        files.set(filePath, { path: filePath, exists: false, isGitTracked: false });
      }
    }

    // Session counter
    const currentCounter = this.sessionCounters.get(effectiveSessionId) || 0;
    const checkpointNumber = currentCounter + 1;
    this.sessionCounters.set(effectiveSessionId, checkpointNumber);

    const checkpoint: MessageCheckpoint = {
      id: this.generateId(),
      messageId,
      checkpointNumber,
      timestamp: Date.now(),
      description,
      files,
      metadata: { filesChanged: files.size, totalSize }
    };

    this.checkpoints.set(checkpoint.id, checkpoint);
    await this.saveCheckpoints();
    await this.saveSessionCounters();
    await this.cleanupOldCheckpoints();

    console.log(`✅ Checkpoint ${checkpointNumber} created: ${checkpoint.id} (${files.size} files)`);
    return checkpoint;
  }

  /**
   * Erstellt einen Checkpoint spezifisch nach einem Plan-Schritt
   */
  async createCheckpointAfterStep(planId: string, stepId: string, stepResult: any): Promise<MessageCheckpoint> {
    const description = `Snapshot nach Ausführung von Plan ${planId}, Schritt ${stepId}`;

    // Extrahiere geänderte Dateien aus dem Resultat (falls vorhanden)
    let changedFiles: string[] = [];
    if (stepResult && typeof stepResult === 'object') {
      if (Array.isArray(stepResult.changedFiles)) {
        changedFiles = stepResult.changedFiles;
      } else if (stepResult.path) {
        changedFiles = [stepResult.path];
      }
    }

    // Falls keine Dateien erkannt wurden, nehmen wir den gesamten Workspace (oder lassen es leer, createCheckpoint braucht eine Liste)
    // In der Praxis sind Checkpoints meist dateibasiert.

    console.log(`[Checkpoint] Creating auto-checkpoint for plan ${planId}, step ${stepId}`);

    return await this.createCheckpoint(
      `plan-${planId}-step-${stepId}`,
      description,
      changedFiles
    );
  }

  async restoreCheckpoint(checkpointId: string): Promise<RestoreResult> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) return { success: false, filesRestored: [], errors: ['Checkpoint not found'] };

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return { success: false, filesRestored: [], errors: ['No workspace open'] };

    const filesRestored: string[] = [];
    const errors: string[] = [];

    for (const [filePath, snapshot] of checkpoint.files) {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

      try {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });

        if (snapshot.content !== undefined) {
          await fs.writeFile(absolutePath, snapshot.content, 'utf-8');
        } else if (snapshot.diff) {
          // Try Git restore first
          try {
            await this.gitDiffService.applyDiff(filePath, snapshot.diff);
          } catch {
            // Fallback: full content wurde schon im Snapshot gespeichert (siehe createCheckpoint)
            if (snapshot.content) await fs.writeFile(absolutePath, snapshot.content, 'utf-8');
          }
        } else if (!snapshot.exists) {
          if (await this.fileExists(absolutePath)) await fs.unlink(absolutePath);
        }

        filesRestored.push(filePath);
      } catch (error) {
        errors.push(`Failed to restore ${filePath}: ${error}`);
      }
    }

    console.log(`✅ Checkpoint restored: ${checkpointId} (${filesRestored.length} files)`);
    return { success: errors.length === 0, filesRestored, errors: errors.length ? errors : undefined };
  }

  /**
   * Holt einen Checkpoint für eine Message-ID
   */
  getCheckpointForMessage(messageId: string): MessageCheckpoint | undefined {
    return Array.from(this.checkpoints.values()).find(
      cp => cp.messageId === messageId
    );
  }

  /**
   * Holt alle Checkpoints für eine Message-ID
   */
  getCheckpointsForMessage(messageId: string): MessageCheckpoint[] {
    return Array.from(this.checkpoints.values())
      .filter(cp => cp.messageId === messageId)
      .sort((a, b) => b.checkpointNumber - a.checkpointNumber);
  }

  /**
   * Holt alle Checkpoints
   */
  getAllCheckpoints(): MessageCheckpoint[] {
    return Array.from(this.checkpoints.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  /**
   * Löscht einen Checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    const deleted = this.checkpoints.delete(checkpointId);
    if (deleted) {
      await this.saveCheckpoints();
    }
    return deleted;
  }

  /**
   * Holt Checkpoint-Statistiken
   */
  getStats(): CheckpointStats {
    const checkpoints = this.getAllCheckpoints();
    const totalSize = checkpoints.reduce((sum, cp) => sum + cp.metadata.totalSize, 0);
    const allFiles = new Set<string>();

    checkpoints.forEach(cp => {
      cp.files.forEach((_, path) => allFiles.add(path));
    });

    return {
      totalCheckpoints: checkpoints.length,
      totalFilesTracked: allFiles.size,
      totalSize,
      oldestCheckpoint: checkpoints.length > 0
        ? new Date(checkpoints[checkpoints.length - 1].timestamp)
        : undefined,
      newestCheckpoint: checkpoints.length > 0
        ? new Date(checkpoints[0].timestamp)
        : undefined
    };
  }

  /**
   * Lädt Checkpoints aus dem Storage
   */
  private async loadCheckpoints(): Promise<void> {
    try {
      const stored = this.context.globalState.get<SerializedCheckpoint[]>(this.storageKey, []);

      this.checkpoints = new Map(
        stored.map(scp => {
          const files = new Map<string, FileSnapshot>(scp.files);
          const checkpoint: MessageCheckpoint = {
            ...scp,
            files
          };
          return [scp.id, checkpoint];
        })
      );

      console.log(`📦 Loaded ${this.checkpoints.size} checkpoints`);
    } catch (error) {
      console.error('Failed to load checkpoints:', error);
      this.checkpoints = new Map();
    }
  }

  /**
   * Speichert Checkpoints im Storage
   */
  private async saveCheckpoints(): Promise<void> {
    try {
      const toStore: SerializedCheckpoint[] = Array.from(this.checkpoints.values()).map(cp => {
        const { files, ...rest } = cp;
        return {
          ...rest,
          files: Array.from(files.entries())
        };
      });

      await this.context.globalState.update(this.storageKey, toStore);
    } catch (error) {
      console.error('Failed to save checkpoints:', error);
    }
  }

  /**
   * Lädt Session-Counter aus dem Storage
   */
  private async loadSessionCounters(): Promise<void> {
    try {
      const stored = this.context.globalState.get<Record<string, number>>(this.sessionCountersKey, {});
      this.sessionCounters = new Map(Object.entries(stored));
      console.log(`📊 Loaded ${this.sessionCounters.size} session counters`);
    } catch (error) {
      console.error('Failed to load session counters:', error);
      this.sessionCounters = new Map();
    }
  }

  /**
   * Speichert Session-Counter im Storage
   */
  private async saveSessionCounters(): Promise<void> {
    try {
      const toStore = Object.fromEntries(this.sessionCounters);
      await this.context.globalState.update(this.sessionCountersKey, toStore);
    } catch (error) {
      console.error('Failed to save session counters:', error);
    }
  }

  /**
   * Cleanup alte Checkpoints (behalte nur die letzten N)
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    const checkpoints = this.getAllCheckpoints();

    if (checkpoints.length > this.maxCheckpoints) {
      const toDelete = checkpoints.slice(this.maxCheckpoints);

      for (const cp of toDelete) {
        this.checkpoints.delete(cp.id);
      }

      await this.saveCheckpoints();
      console.log(`🧹 Cleaned up ${toDelete.length} old checkpoints`);
    }
  }

  /**
   * Checks if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generiert eine eindeutige ID
   */
  private generateId(): string {
    return `cp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Löscht alle Checkpoints (für Testing)
   */
  async clearAll(): Promise<void> {
    this.checkpoints.clear();
    await this.saveCheckpoints();
    console.log('🗑️ All checkpoints cleared');
  }

  /**
   * Ressourcen freigeben
   */
  dispose() {
    this.checkpoints.clear();
    this.sessionCounters.clear();
  }
}

