/**
 * Checkpoint System Types for Gently
 *
 * Message-Based Checkpoints (Augment Code Style)
 * - Checkpoint bei jedem Agent-Prompt
 * - Hover-to-Revert UI
 * - Conversation-Based Storage
 */

export interface FileSnapshot {
  path: string;
  content?: string; // Optional if diff is present
  diff?: string; // Git diff if tracked
  exists: boolean; // false if file was deleted
  isGitTracked?: boolean;
}

export interface MessageCheckpoint {
  id: string;
  messageId: string; // ID der Chat-Message
  checkpointNumber: number; // Checkpoint 1, 2, 3, etc.
  timestamp: number;
  description: string; // "Created login function"
  files: Map<string, FileSnapshot>; // filePath -> snapshot
  metadata: CheckpointMetadata;
}

/**
 * Storage-Format für die Serialisierung (da Map nicht direkt JSON-kompatibel ist)
 */
export interface SerializedCheckpoint {
  id: string;
  messageId: string;
  checkpointNumber: number;
  timestamp: number;
  description: string;
  files: [string, FileSnapshot][]; // Array von Tuples statt Map oder Object
  metadata: CheckpointMetadata;
}

export interface CheckpointMetadata {
  filesChanged: number;
  totalSize: number; // in bytes
  agentAction?: string; // z.B. "write_file", "edit_file"
}

export interface CheckpointStats {
  totalCheckpoints: number;
  totalFilesTracked: number;
  totalSize: number;
  oldestCheckpoint?: Date;
  newestCheckpoint?: Date;
}

export interface RestoreResult {
  success: boolean;
  filesRestored: string[];
  errors?: string[];
}

