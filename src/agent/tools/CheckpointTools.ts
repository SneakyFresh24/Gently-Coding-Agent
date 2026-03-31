// =====================================================
// Checkpoint Tools - Checkpoint management tools
// =====================================================

import { CheckpointManager } from '../checkpoints/CheckpointManager';
import { ToolRegistry } from './ToolRegistry';

export class CheckpointTools {
  constructor(
    private checkpointManager: CheckpointManager
  ) { }

  /**
   * Register all checkpoint-related tools
   */
  registerTools(registry: ToolRegistry): void {
    registry.register('create_checkpoint', this.createCheckpoint.bind(this));
    registry.register('restore_checkpoint', this.restoreCheckpoint.bind(this));
    registry.register('list_checkpoints', this.listCheckpoints.bind(this));
    registry.register('show_checkpoint_diff', this.showCheckpointDiff.bind(this));
  }

  private async createCheckpoint(params: any): Promise<any> {
    try {
      const checkpoint = await this.checkpointManager.createCheckpoint(
        params.messageId,
        params.description,
        params.filePaths
      );

      return {
        success: true,
        checkpointId: checkpoint.id,
        filesTracked: checkpoint.metadata.filesChanged
      };
    } catch (error) {
      console.error('[CheckpointTools] Error creating checkpoint:', error);
      return {
        success: false,
        message: `Error creating checkpoint: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async restoreCheckpoint(params: any): Promise<any> {
    try {
      const result = await this.checkpointManager.restoreCheckpoint(params.checkpointId, {
        mode: params.mode || 'files'
      });
      return result;
    } catch (error) {
      console.error('[CheckpointTools] Error restoring checkpoint:', error);
      return {
        success: false,
        message: `Error restoring checkpoint: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async listCheckpoints(): Promise<any> {
    try {
      const checkpoints = await this.checkpointManager.getAllCheckpoints();
      return {
        success: true,
        checkpoints: checkpoints.map(cp => ({
          id: cp.id,
          messageId: cp.messageId,
          description: cp.description,
          timestamp: cp.timestamp,
          filesChanged: cp.metadata.filesChanged,
          commitHash: cp.commitHash,
          checkpointNumber: cp.checkpointNumber
        }))
      };
    } catch (error) {
      console.error('[CheckpointTools] Error listing checkpoints:', error);
      return {
        success: false,
        message: `Error listing checkpoints: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async showCheckpointDiff(params: any): Promise<any> {
    try {
      const diff = await this.checkpointManager.getDiffSet(params.fromCheckpointId, params.toCheckpointId);
      return {
        success: true,
        ...diff
      };
    } catch (error) {
      console.error('[CheckpointTools] Error getting checkpoint diff:', error);
      return {
        success: false,
        message: `Error getting checkpoint diff: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
