import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { GitCommandRunner } from './GitCommandRunner';
import { CheckpointLock } from './CheckpointLock';
import {
  CheckpointDiffResult,
  CheckpointMetadata,
  CheckpointRecord,
  CheckpointRestoreMode,
  DiffFile,
  DiffHunk,
  RestoreOptions,
  RestoreResult,
  SerializedCheckpoint
} from './types';

const LEGACY_MAPPING_FILE = 'legacy-mapping.json';
const MIGRATION_STATE_FILE = 'migration-state.json';
const LOG_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

const BUILTIN_EXCLUDES = [
  'node_modules/',
  'vendor/',
  '.venv/',
  '__pycache__/',
  'dist/',
  'build/',
  'out/',
  '.next/',
  '.nuxt/',
  '.idea/',
  '.vscode/',
  '*.swp',
  '*.swo',
  '.DS_Store',
  'Thumbs.db',
  '*.min.js',
  '*.min.css',
  '*.map',
  '.git/',
  '.gitignore',
  '.gitmodules',
  '.env',
  '.env.local',
  '.env.*.local',
  '.cache/',
  '.tmp/',
  '*.log'
];

interface CreateCheckpointInput {
  messageId: string;
  sessionId: string;
  checkpointNumber: number;
  description: string;
  metadata: CheckpointMetadata;
}

interface CommitMeta {
  checkpointNumber: number;
  messageId: string;
  sessionId: string;
  timestamp: number;
  description: string;
  filesChanged: number;
  totalSize: number;
  legacyId?: string;
}

export class ShadowCheckpointStore {
  private initialized = false;
  private readonly workspaceHash: string;
  private readonly shadowRoot: string;
  private readonly gitDir: string;
  private readonly gitRunner: GitCommandRunner;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly workspaceRoot: string
  ) {
    this.workspaceHash = this.hashWorkspace(workspaceRoot);
    this.shadowRoot = this.getShadowRepoPath(this.workspaceHash);
    this.gitDir = path.join(this.shadowRoot, 'repo.git');
    this.gitRunner = new GitCommandRunner({
      gitDir: this.gitDir,
      workTree: this.workspaceRoot
    });
  }

  getWorkspaceHash(): string {
    return this.workspaceHash;
  }

  getShadowRepoPath(workspaceHash: string): string {
    const storagePath = this.context.globalStorageUri.fsPath;
    return path.join(storagePath, 'checkpoints', workspaceHash);
  }

  hashWorkspace(workspacePath: string): string {
    return createHash('sha256').update(workspacePath).digest('hex').slice(0, 16);
  }

  async createCheckpoint(input: CreateCheckpointInput): Promise<CheckpointRecord> {
    await this.ensureInitialized();
    return CheckpointLock.withWorkspaceLock(this.workspaceHash, this.shadowRoot, async () => {
      await this.gitRunner.run(['add', '-A']);
      const changedFiles = await this.getStagedFileList();
      const totalSize = await this.estimateSizeBytes(changedFiles);
      const metadata: CheckpointMetadata = {
        ...input.metadata,
        filesChanged: changedFiles.length,
        totalSize
      };
      const commitMeta: CommitMeta = {
        checkpointNumber: input.checkpointNumber,
        messageId: input.messageId,
        sessionId: input.sessionId,
        timestamp: Date.now(),
        description: input.description,
        filesChanged: metadata.filesChanged,
        totalSize: metadata.totalSize
      };
      await this.gitRunner.run(['commit', '--allow-empty', '-m', this.formatCommitSubject(commitMeta), '-m', this.formatCommitBody(commitMeta)]);
      const hash = (await this.gitRunner.run(['rev-parse', 'HEAD'])).stdout.trim();
      const parent = (await this.gitRunner.run(['rev-parse', 'HEAD^'], true)).stdout.trim();
      return {
        id: hash,
        messageId: input.messageId,
        sessionId: input.sessionId,
        checkpointNumber: input.checkpointNumber,
        commitHash: hash,
        parentCommitHash: parent || undefined,
        timestamp: commitMeta.timestamp,
        description: input.description,
        metadata
      };
    });
  }

  async listCheckpoints(): Promise<CheckpointRecord[]> {
    await this.ensureInitialized();
    const result = await this.gitRunner.run(['log', '--pretty=format:%H' + FIELD_SEPARATOR + '%P' + FIELD_SEPARATOR + '%s' + FIELD_SEPARATOR + '%b' + LOG_SEPARATOR], true);
    const entries = result.stdout
      .split(LOG_SEPARATOR)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => this.parseLogEntry(line))
      .filter((entry): entry is CheckpointRecord => Boolean(entry));
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  }

  async getCheckpoint(id: string): Promise<CheckpointRecord | undefined> {
    const mapping = await this.readLegacyMapping();
    const resolvedId = mapping[id] || id;
    const checkpoints = await this.listCheckpoints();
    return checkpoints.find((cp) => cp.id === resolvedId || cp.commitHash === resolvedId || cp.legacyId === id);
  }

  async restoreCheckpoint(checkpointId: string, options: RestoreOptions = {}): Promise<RestoreResult> {
    await this.ensureInitialized();
    const mode: CheckpointRestoreMode = options.mode || 'files';
    const checkpoint = await this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return {
        success: false,
        mode,
        filesRestored: [],
        errors: ['Checkpoint not found']
      };
    }

    return CheckpointLock.withWorkspaceLock(this.workspaceHash, this.shadowRoot, async () => {
      const filesRestored = await this.getChangedFilesInCommit(checkpoint.commitHash);
      let messagesPruned = 0;
      const errors: string[] = [];
      if (mode === 'files' || mode === 'files&task') {
        try {
          await this.gitRunner.run(['reset', '--hard', checkpoint.commitHash]);
        } catch (error) {
          errors.push(String(error));
        }
      }

      if (mode === 'task' || mode === 'files&task') {
        try {
          const history = options.messageHistory || [];
          const index = history.findIndex((m) => m.id === checkpoint.messageId);
          if (index >= 0 && options.pruneHistory) {
            const pruned = await options.pruneHistory(index + 1);
            messagesPruned = Number(pruned || 0);
          }
        } catch (error) {
          errors.push(String(error));
        }
      }

      return {
        success: errors.length === 0,
        mode,
        restoredCommit: checkpoint.commitHash,
        checkpointNumber: checkpoint.checkpointNumber,
        filesRestored,
        messagesPruned: messagesPruned > 0 ? messagesPruned : undefined,
        errors: errors.length > 0 ? errors : undefined
      };
    });
  }

  async getDiffSet(fromCheckpointId: string, toCheckpointId?: string): Promise<CheckpointDiffResult> {
    await this.ensureInitialized();
    const from = await this.getCheckpoint(fromCheckpointId);
    if (!from) {
      throw new Error(`Checkpoint not found: ${fromCheckpointId}`);
    }
    const to = toCheckpointId ? await this.getCheckpoint(toCheckpointId) : undefined;
    const nameStatusArgs = to
      ? ['diff', '--name-status', `${from.commitHash}..${to.commitHash}`]
      : ['diff', '--name-status', from.commitHash];
    const raw = await this.gitRunner.run(nameStatusArgs, true);
    const files = raw.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => this.parseNameStatusLine(line))
      .filter((line): line is { status: 'A' | 'M' | 'D' | 'R'; path: string; oldPath?: string } => Boolean(line));

    const diffFiles: DiffFile[] = [];
    for (const file of files) {
      const diffArgs = to
        ? ['diff', '-U3', `${from.commitHash}..${to.commitHash}`, '--', file.path]
        : ['diff', '-U3', from.commitHash, '--', file.path];
      const diffRaw = await this.gitRunner.run(diffArgs, true);
      const before = await this.readContentAtCommit(from.commitHash, file.oldPath || file.path);
      const after = to
        ? await this.readContentAtCommit(to.commitHash, file.path)
        : await this.readWorkingFile(file.path);
      diffFiles.push({
        relativePath: file.path,
        absolutePath: path.join(this.workspaceRoot, file.path),
        status: file.status,
        hunks: this.parseHunks(diffRaw.stdout),
        beforeContent: before,
        afterContent: after
      });
    }

    return {
      fromCheckpointId,
      toCheckpointId,
      files: diffFiles
    };
  }

  async migrateLegacyCheckpoints(legacyCheckpoints: SerializedCheckpoint[]): Promise<Record<string, string>> {
    await this.ensureInitialized();
    const existingState = await this.readMigrationState();
    if (existingState?.migrationComplete) {
      return await this.readLegacyMapping();
    }

    const sorted = [...legacyCheckpoints].sort((a, b) => a.timestamp - b.timestamp);
    return CheckpointLock.withWorkspaceLock(this.workspaceHash, this.shadowRoot, async () => {
      const mapping = await this.readLegacyMapping();
      for (const legacy of sorted) {
        if (mapping[legacy.id]) continue;
        const meta: CommitMeta = {
          checkpointNumber: legacy.checkpointNumber,
          messageId: legacy.messageId,
          sessionId: 'legacy-migration',
          timestamp: legacy.timestamp,
          description: legacy.description,
          filesChanged: legacy.metadata?.filesChanged || 0,
          totalSize: legacy.metadata?.totalSize || 0,
          legacyId: legacy.id
        };
        await this.gitRunner.run(['commit', '--allow-empty', '-m', this.formatCommitSubject(meta), '-m', this.formatCommitBody(meta)]);
        const hash = (await this.gitRunner.run(['rev-parse', 'HEAD'])).stdout.trim();
        mapping[legacy.id] = hash;
      }
      await this.writeLegacyMapping(mapping);
      await this.writeMigrationState({ migrationVersion: 1, migrationComplete: true, completedAt: Date.now() });
      return mapping;
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.shadowRoot, { recursive: true });
    const gitDirExists = await this.exists(this.gitDir);
    if (!gitDirExists) {
      await fs.mkdir(this.gitDir, { recursive: true });
      await this.gitRunner.runWithoutContext(['init', '--bare', this.gitDir]);
      await this.setupExclusions();
    }

    const hasHead = (await this.gitRunner.run(['rev-parse', '--verify', 'HEAD'], true)).stdout.trim().length > 0;
    if (!hasHead) {
      await this.gitRunner.run(['add', '-A']);
      const baselineMeta: CommitMeta = {
        checkpointNumber: 0,
        messageId: 'baseline',
        sessionId: 'baseline',
        timestamp: Date.now(),
        description: 'Initial workspace baseline',
        filesChanged: 0,
        totalSize: 0
      };
      await this.gitRunner.run(['commit', '--allow-empty', '-m', this.formatCommitSubject(baselineMeta), '-m', this.formatCommitBody(baselineMeta)]);
    }
    this.initialized = true;
  }

  private async setupExclusions(): Promise<void> {
    const excludePath = path.join(this.gitDir, 'info', 'exclude');
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, BUILTIN_EXCLUDES.join('\n') + '\n', 'utf8');
  }

  private formatCommitSubject(meta: CommitMeta): string {
    return `checkpoint:${meta.checkpointNumber}`;
  }

  private formatCommitBody(meta: CommitMeta): string {
    const descB64 = Buffer.from(meta.description || '', 'utf8').toString('base64');
    return [
      `messageId=${meta.messageId}`,
      `sessionId=${meta.sessionId}`,
      `timestamp=${meta.timestamp}`,
      `description_b64=${descB64}`,
      `filesChanged=${meta.filesChanged}`,
      `totalSize=${meta.totalSize}`,
      ...(meta.legacyId ? [`legacyId=${meta.legacyId}`] : [])
    ].join('\n');
  }

  private parseLogEntry(entry: string): CheckpointRecord | undefined {
    const parts = entry.split(FIELD_SEPARATOR);
    if (parts.length < 4) return undefined;
    const [hash, parentRaw, subject, bodyRaw] = parts;
    if (!subject.startsWith('checkpoint:')) return undefined;
    const checkpointNumber = Number(subject.split(':')[1] || 0);
    const bodyLines = bodyRaw.split('\n');
    const map: Record<string, string> = {};
    for (const line of bodyLines) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      map[key] = value;
    }
    const description = map.description_b64
      ? Buffer.from(map.description_b64, 'base64').toString('utf8')
      : '';
    return {
      id: hash,
      commitHash: hash,
      parentCommitHash: parentRaw ? parentRaw.split(' ')[0] : undefined,
      checkpointNumber: Number.isFinite(checkpointNumber) ? checkpointNumber : 0,
      messageId: map.messageId || '',
      sessionId: map.sessionId || 'default-session',
      timestamp: Number(map.timestamp || Date.now()),
      description,
      metadata: {
        filesChanged: Number(map.filesChanged || 0),
        totalSize: Number(map.totalSize || 0)
      },
      legacyId: map.legacyId
    };
  }

  private async getStagedFileList(): Promise<string[]> {
    const result = await this.gitRunner.run(['diff', '--cached', '--name-only'], true);
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private async estimateSizeBytes(files: string[]): Promise<number> {
    let size = 0;
    for (const file of files) {
      try {
        const stats = await fs.stat(path.join(this.workspaceRoot, file));
        size += stats.size;
      } catch {
        // File might be deleted; ignore.
      }
    }
    return size;
  }

  private async getChangedFilesInCommit(commitHash: string): Promise<string[]> {
    const result = await this.gitRunner.run(['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash], true);
    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private parseNameStatusLine(line: string): { status: 'A' | 'M' | 'D' | 'R'; path: string; oldPath?: string } | undefined {
    const parts = line.split('\t');
    if (parts.length < 2) return undefined;
    const rawStatus = parts[0].trim();
    const status = rawStatus.startsWith('R')
      ? 'R'
      : (rawStatus.charAt(0) as 'A' | 'M' | 'D');
    if (status === 'R' && parts.length >= 3) {
      return { status, oldPath: parts[1], path: parts[2] };
    }
    return { status, path: parts[1] };
  }

  private parseHunks(diffText: string): DiffHunk[] {
    const lines = diffText.split('\n');
    const hunks: DiffHunk[] = [];
    let current: DiffHunk | null = null;
    for (const line of lines) {
      const match = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/.exec(line);
      if (match) {
        if (current) hunks.push(current);
        current = {
          oldStart: Number(match[1]),
          oldLines: Number(match[2] || 1),
          newStart: Number(match[3]),
          newLines: Number(match[4] || 1),
          content: `${line}\n`
        };
        continue;
      }
      if (current) {
        current.content += `${line}\n`;
      }
    }
    if (current) hunks.push(current);
    if (hunks.length === 0 && diffText.trim().length > 0) {
      hunks.push({
        oldStart: 0,
        oldLines: 0,
        newStart: 0,
        newLines: 0,
        content: diffText
      });
    }
    return hunks;
  }

  private async readContentAtCommit(commit: string, relativePath: string): Promise<string | undefined> {
    const res = await this.gitRunner.run(['show', `${commit}:${relativePath}`], true);
    if (res.stderr && res.stderr.toLowerCase().includes('exists on disk, but not in')) {
      return undefined;
    }
    const text = res.stdout;
    return text.length > 0 ? text : undefined;
  }

  private async readWorkingFile(relativePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(path.join(this.workspaceRoot, relativePath), 'utf8');
    } catch {
      return undefined;
    }
  }

  private async readLegacyMapping(): Promise<Record<string, string>> {
    const mappingPath = path.join(this.shadowRoot, LEGACY_MAPPING_FILE);
    try {
      const raw = await fs.readFile(mappingPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }

  private async writeLegacyMapping(mapping: Record<string, string>): Promise<void> {
    const mappingPath = path.join(this.shadowRoot, LEGACY_MAPPING_FILE);
    await fs.writeFile(mappingPath, JSON.stringify(mapping, null, 2), 'utf8');
  }

  private async readMigrationState(): Promise<{ migrationVersion: number; migrationComplete: boolean; completedAt?: number } | null> {
    const statePath = path.join(this.shadowRoot, MIGRATION_STATE_FILE);
    try {
      const raw = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        migrationVersion: Number(parsed.migrationVersion || 0),
        migrationComplete: Boolean(parsed.migrationComplete),
        completedAt: parsed.completedAt ? Number(parsed.completedAt) : undefined
      };
    } catch {
      return null;
    }
  }

  private async writeMigrationState(state: { migrationVersion: number; migrationComplete: boolean; completedAt?: number }): Promise<void> {
    const statePath = path.join(this.shadowRoot, MIGRATION_STATE_FILE);
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
  }

  private async exists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
