import { Memory, MemoryContext } from './types';
import { ScopeManager } from './ScopeManager';

export class MemoryScopeFilter {
    private scopeManager: ScopeManager;

    constructor(scopeManager: ScopeManager) {
        this.scopeManager = scopeManager;
    }

    /**
     * Filter memories based on current context
     */
    filter(memories: Memory[], context?: MemoryContext): { memory: Memory; score: number }[] {
        if (!context) {
            // Return only global memories if no context
            return memories
                .filter(m => !m.scope)
                .map(m => ({ memory: m, score: 1.0 }));
        }

        return memories
            .map(memory => {
                if (!memory.scope) {
                    return { memory, score: 0.8 }; // Global memories get a base score when context is present
                }

                const matchResult = this.scopeManager.matchesContext(memory.scope, context);
                if (!matchResult.matches) {
                    return null;
                }

                return {
                    memory,
                    score: matchResult.score
                };
            })
            .filter((result): result is { memory: Memory; score: number } => result !== null);
    }
}
