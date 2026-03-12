// =====================================================
// System Handler
// =====================================================

import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';

export class SystemHandler {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly sendMessageToWebview: (message: any) => void
  ) { }

  async handleGetValidationMetrics(): Promise<void> {
    try {
      const metrics = this.agentManager.getValidationMetrics();

      this.sendMessageToWebview({
        type: 'validationMetrics',
        metrics
      });
    } catch (error) {
      console.error('[SystemHandler] Error getting validation metrics:', error);
    }
  }

  async handleEnhancePrompt(prompt: string): Promise<void> {
    try {
      console.log('[SystemHandler] Enhancing prompt requested - but PromptEnhancer is disabled in BYOK mode');
      this.sendMessageToWebview({
        type: 'promptEnhanceError',
        error: 'Prompt enhancement is currently disabled in BYOK mode.'
      });
    } catch (error) {
      console.error('[SystemHandler] Error enhancing prompt:', error);
    }
  }

  /**
   * Get system information
   */
  async getSystemInfo(): Promise<any> {
    try {
      const context = await this.agentManager.getContext();
      const stats = this.agentManager.getContextStats();

      return {
        workspace: {
          name: vscode.workspace.name || 'No workspace',
          path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'N/A',
          folders: vscode.workspace.workspaceFolders?.map(f => f.name) || []
        },
        indexing: {
          totalFiles: stats.totalFiles,
          maxTokens: stats.maxTokens
        },
        validation: {
          enabled: false, // Would need to check actual validation manager
          strictMode: false
        }
      };
    } catch (error) {
      console.error('[SystemHandler] Error getting system info:', error);
      return null;
    }
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<any> {
    try {
      const indexer = this.agentManager.getIndexer();
      const fileIndexer = this.agentManager.getIndexer();

      return {
        indexing: {
          totalFiles: fileIndexer.getAllIndexedFiles().length,
          recentlyIndexed: null // Would need actual incremental indexer
        },
        memory: {
          // Memory usage stats would be implemented here
          heapUsed: 0,
          heapTotal: 0,
          external: 0
        },
        performance: {
          // Performance metrics would be implemented here
          averageResponseTime: 0,
          requestCount: 0,
          errorRate: 0
        }
      };
    } catch (error) {
      console.error('[SystemHandler] Error getting performance metrics:', error);
      return null;
    }
  }

  /**
   * Handle system reset
   */
  async handleSystemReset(): Promise<void> {
    try {
      console.log('[SystemHandler] Performing system reset...');

      // Reset context
      const contextManager = this.agentManager.getContextManager();
      // Clear tracked files (would need actual clear method)

      // Reset indexer
      await this.agentManager.getIndexer().clearIndex();

      // Reset validation manager (would need actual validation manager)

      this.sendMessageToWebview({
        type: 'systemReset',
        success: true,
        message: 'System reset completed successfully'
      });

    } catch (error) {
      console.error('[SystemHandler] Error during system reset:', error);
      this.sendMessageToWebview({
        type: 'systemReset',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }

  /**
   * Handle system diagnostics
   */
  async handleSystemDiagnostics(): Promise<void> {
    try {
      console.log('[SystemHandler] Running system diagnostics...');

      const diagnostics = {
        timestamp: Date.now(),
        status: 'running',
        checks: {
          indexer: await this.checkIndexerHealth(),
          validation: await this.checkValidationHealth(),
          context: await this.checkContextHealth(),
          memory: await this.checkMemoryHealth()
        }
      };

      this.sendMessageToWebview({
        type: 'systemDiagnostics',
        diagnostics
      });

    } catch (error) {
      console.error('[SystemHandler] Error running system diagnostics:', error);
      this.sendMessageToWebview({
        type: 'systemDiagnostics',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }

  private async checkIndexerHealth(): Promise<any> {
    try {
      const indexer = this.agentManager.getIndexer();
      const files = indexer.getAllIndexedFiles();

      return {
        status: 'healthy',
        totalFiles: files.length,
        lastIndexed: files.length > 0 ? Date.now() : null
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkValidationHealth(): Promise<any> {
    try {
      // Would need actual validation manager
      return {
        status: 'disabled',
        note: 'Validation manager not available'
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkContextHealth(): Promise<any> {
    try {
      const contextManager = this.agentManager.getContextManager();
      const stats = contextManager.getStats();

      return {
        status: 'healthy',
        totalFiles: stats.totalFiles,
        maxTokens: stats.maxTokens
      };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkMemoryHealth(): Promise<any> {
    try {
      // Memory health check would be implemented here
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const memory = process.memoryUsage();

        return {
          status: 'healthy',
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
          rss: memory.rss
        };
      }

      return { status: 'unknown' };
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Handle system configuration
   */
  async handleUpdateSystemConfig(config: any): Promise<void> {
    try {
      console.log('[SystemHandler] Updating system configuration:', config);

      // Update configuration based on provided settings
      if (config.validation) {
        // Would need actual validation manager
        console.log('[SystemHandler] Validation config update not implemented');
      }

      if (config.context) {
        const contextManager = this.agentManager.getContextManager();
        if (config.context.maxTokens) {
          contextManager.setMaxTokens(config.context.maxTokens);
        }
      }

      this.sendMessageToWebview({
        type: 'systemConfigUpdated',
        success: true,
        config
      });

    } catch (error) {
      console.error('[SystemHandler] Error updating system configuration:', error);
      this.sendMessageToWebview({
        type: 'systemConfigUpdated',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    }
  }
}