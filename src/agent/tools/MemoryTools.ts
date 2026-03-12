// =====================================================
// Memory Tools - Memory management tools for the agent
// =====================================================

import { MemoryManager } from '../memory';
import { ToolRegistry } from './ToolRegistry';

export class MemoryTools {
  constructor(private memoryManager: MemoryManager) { }

  /**
   * Register all memory-related tools
   */
  registerTools(registry: ToolRegistry): void {
    registry.register('remember', this.remember.bind(this));
    registry.register('recall_memories', this.recallMemories.bind(this));
    registry.register('update_memory', this.updateMemory.bind(this));
    registry.register('deprecate_memory', this.deprecateMemory.bind(this));
    registry.register('check_memory_conflicts', this.checkMemoryConflicts.bind(this));
    registry.register('record_correction', this.recordCorrection.bind(this));
    registry.register('check_pattern_suggestions', this.checkPatternSuggestions.bind(this));
    registry.register('accept_pattern_suggestion', this.acceptPatternSuggestion.bind(this));
    registry.register('reject_pattern_suggestion', this.rejectPatternSuggestion.bind(this));
  }

  private async remember(params: any): Promise<any> {
    try {
      console.log('[MemoryTools] remember tool called with params:', params);

      // Check for conflicts first
      const conflicts = await this.memoryManager.detectConflicts(params.content, params.category);

      if (conflicts.length > 0) {
        // Return conflict warning
        return {
          success: false,
          hasConflicts: true,
          message: `⚠️ Potential conflict detected! This information might contradict existing memories.`,
          conflicts: conflicts.map(c => ({
            existingContent: c.existingMemory.content,
            existingId: c.existingMemory.id,
            reason: c.conflictReason,
            similarity: c.similarity
          })),
          suggestion: 'Consider using update_memory or deprecate_memory to handle the conflicting memory first.'
        };
      }

      // Validate scope if provided
      if (params.scope) {
        const validation = this.memoryManager.validateScope(params.scope);
        if (!validation.valid) {
          return {
            success: false,
            message: `Invalid scope: ${validation.errors.join(', ')}`
          };
        }
      }

      // No conflicts, add memory
      const memory = await this.memoryManager.addMemory(
        params.content,
        'agent',
        params.category,
        params.scope
      );
      console.log('[MemoryTools] Memory added successfully:', memory.id);

      let scopeInfo = '';
      if (memory.scope) {
        const scopeParts = [];
        if (memory.scope.language) scopeParts.push(`languages: ${memory.scope.language.join(', ')}`);
        if (memory.scope.pathPattern) scopeParts.push(`paths: ${memory.scope.pathPattern.join(', ')}`);
        if (memory.scope.fileType) scopeParts.push(`file types: ${memory.scope.fileType.join(', ')}`);
        scopeInfo = ` (scoped to ${scopeParts.join('; ')})`;
      }

      return {
        success: true,
        message: `Remembered: ${params.content}${scopeInfo}`,
        memoryId: memory.id,
        category: memory.category,
        confidence: memory.confidence,
        scope: memory.scope
      };
    } catch (error) {
      console.error('[MemoryTools] Error adding memory:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async recallMemories(params: any): Promise<any> {
    try {
      const memories = await this.memoryManager.getRelevantMemories(
        params.context,
        params.maxCount || 5
      );
      return {
        success: true,
        memories: memories.map(r => ({
          content: r.memory.content,
          category: r.memory.category,
          score: r.score,
          reason: r.reason
        }))
      };
    } catch (error) {
      console.error('[MemoryTools] Error recalling memories:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async updateMemory(params: any): Promise<any> {
    try {
      const updated = await this.memoryManager.updateMemory(
        params.memoryId,
        params.newContent,
        params.category
      );
      if (updated) {
        return {
          success: true,
          message: `Memory updated: ${params.newContent}`,
          memory: {
            id: updated.id,
            content: updated.content,
            category: updated.category
          }
        };
      } else {
        return {
          success: false,
          message: 'Memory not found'
        };
      }
    } catch (error) {
      console.error('[MemoryTools] Error updating memory:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async deprecateMemory(params: any): Promise<any> {
    try {
      const deprecated = await this.memoryManager.deprecateMemory(
        params.memoryId,
        params.reason,
        params.supersededBy
      );
      if (deprecated) {
        return {
          success: true,
          message: `Memory deprecated${params.reason ? ': ' + params.reason : ''}`,
          memory: {
            id: deprecated.id,
            status: deprecated.status
          }
        };
      } else {
        return {
          success: false,
          message: 'Memory not found'
        };
      }
    } catch (error) {
      console.error('[MemoryTools] Error deprecating memory:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkMemoryConflicts(params: any): Promise<any> {
    try {
      const conflicts = await this.memoryManager.detectConflicts(
        params.content,
        params.category
      );
      return {
        success: true,
        hasConflicts: conflicts.length > 0,
        conflicts: conflicts.map(c => ({
          existingContent: c.existingMemory.content,
          existingId: c.existingMemory.id,
          reason: c.conflictReason,
          similarity: c.similarity
        }))
      };
    } catch (error) {
      console.error('[MemoryTools] Error checking memory conflicts:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async recordCorrection(params: any): Promise<any> {
    try {
      await this.memoryManager.recordCorrection(
        params.context,
        params.originalContent,
        params.correctedContent,
        params.fileType,
        params.filePath
      );
      return {
        success: true,
        message: 'Correction recorded. I will learn from this pattern.'
      };
    } catch (error) {
      console.error('[MemoryTools] Error recording correction:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async checkPatternSuggestions(): Promise<any> {
    try {
      const suggestions = this.memoryManager.getReadyPatterns();
      return {
        success: true,
        hasSuggestions: suggestions.length > 0,
        suggestions: suggestions.map(s => ({
          patternId: s.patternId,
          pattern: s.pattern.pattern,
          occurrences: s.pattern.occurrences,
          suggestedMemory: s.suggestedMemory,
          reasoning: s.reasoning,
          confidence: s.confidence
        }))
      };
    } catch (error) {
      console.error('[MemoryTools] Error checking pattern suggestions:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async acceptPatternSuggestion(params: any): Promise<any> {
    try {
      const memory = await this.memoryManager.acceptPatternSuggestion(
        params.patternId,
        params.memoryContent,
        params.category
      );
      return {
        success: true,
        message: `Pattern accepted and memory created: ${params.memoryContent}`,
        memoryId: memory.id
      };
    } catch (error) {
      console.error('[MemoryTools] Error accepting pattern suggestion:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private async rejectPatternSuggestion(params: any): Promise<any> {
    try {
      await this.memoryManager.rejectPatternSuggestion(params.patternId);
      return {
        success: true,
        message: 'Pattern suggestion rejected'
      };
    } catch (error) {
      console.error('[MemoryTools] Error rejecting pattern suggestion:', error);
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
