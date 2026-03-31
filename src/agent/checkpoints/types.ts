import type { Message } from '../../views/chat/types/ChatTypes';

export type CheckpointRestoreMode = 'files' | 'task' | 'files&task';

export interface CheckpointMetadata {
  filesChanged: number;
  totalSize: number;
  agentAction?: string;
}

export interface CheckpointRecord {
  id: string;
  messageId: string;
  sessionId: string;
  checkpointNumber: number;
  commitHash: string;
  parentCommitHash?: string;
  timestamp: number;
  description: string;
  metadata: CheckpointMetadata;
  legacyId?: string;
}

export interface MessageCheckpoint extends CheckpointRecord {}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface DiffFile {
  relativePath: string;
  absolutePath: string;
  status: 'A' | 'M' | 'D' | 'R';
  hunks: DiffHunk[];
  beforeContent?: string;
  afterContent?: string;
}

export interface CheckpointDiffResult {
  fromCheckpointId: string;
  toCheckpointId?: string;
  files: DiffFile[];
}

export interface RestoreResult {
  success: boolean;
  mode: CheckpointRestoreMode;
  restoredCommit?: string;
  filesRestored: string[];
  messagesPruned?: number;
  checkpointNumber?: number;
  errors?: string[];
}

export interface RestoreTaskContext {
  messageHistory?: Message[];
  pruneHistory?: (startIndex: number) => Promise<number> | number;
}

export interface RestoreOptions extends RestoreTaskContext {
  mode?: CheckpointRestoreMode;
}

export interface CheckpointStats {
  totalCheckpoints: number;
  totalFilesTracked: number;
  totalSize: number;
  oldestCheckpoint?: Date;
  newestCheckpoint?: Date;
}

// Legacy snapshot types used only during one-time migration.
export interface FileSnapshot {
  path: string;
  content?: string;
  diff?: string;
  exists: boolean;
  isGitTracked?: boolean;
}

export interface SerializedCheckpoint {
  id: string;
  messageId: string;
  checkpointNumber: number;
  timestamp: number;
  description: string;
  files: [string, FileSnapshot][];
  metadata: CheckpointMetadata;
}
