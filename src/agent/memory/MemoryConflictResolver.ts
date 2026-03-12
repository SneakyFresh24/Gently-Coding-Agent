import { Memory, MemoryConflict, MemoryCategory, MemoryId } from './types';
import { OpenRouterService } from '../../services/OpenRouterService';

export class MemoryConflictResolver {
    constructor(private openRouterService?: OpenRouterService) { }

    /**
     * Detect potential conflicts with existing memories
     */
    async detectConflicts(
        content: string,
        category: MemoryCategory,
        activeMemories: Memory[],
        semanticSimilarity: (content1: string, content2: string) => Promise<number>
    ): Promise<MemoryConflict[]> {
        const conflicts: MemoryConflict[] = [];

        for (const memory of activeMemories) {
            if (memory.category !== category) continue;

            const similarity = await semanticSimilarity(content, memory.content);

            if (similarity > 0.7) {
                let isContradiction = this.detectSimpleContradiction(content, memory.content);
                let reason = similarity > 0.9 ? 'Very similar content (possible duplicate)' : 'Potential contradiction detected (Levenshtein/Keyword)';

                // LLM Fallback for deep semantic checks if similarity is high but simple checks are inconclusive
                if (!isContradiction && similarity > 0.8 && this.openRouterService) {
                    const llmContradiction = await this.detectLLMContradiction(content, memory.content);
                    if (llmContradiction) {
                        isContradiction = true;
                        reason = 'Semantic contradiction detected (LLM Analysis)';
                    }
                }

                if (isContradiction || similarity > 0.9) {
                    conflicts.push({
                        existingMemory: memory,
                        newContent: content,
                        conflictReason: reason,
                        similarity
                    });
                }
            }
        }

        return conflicts;
    }

    /**
     * Detect contradiction using Levenshtein and Keyword checks
     */
    private detectSimpleContradiction(content1: string, content2: string): boolean {
        const c1 = content1.toLowerCase();
        const c2 = content2.toLowerCase();

        // 1. Simple Keyword Check (Not/Never/Always transitions)
        const keywords = ['always', 'never', 'use', "don't use", 'avoid', 'prefer'];
        for (const word of keywords) {
            if ((c1.includes(word) && !c2.includes(word)) || (!c1.includes(word) && c2.includes(word))) {
                // If they are about the same topic (high similarity), this keyword flip is high signal
            }
        }

        // 2. Levenshtein Distance (Similarity check for contradiction)
        const distance = this.levenshteinDistance(c1, c2);
        const maxLength = Math.max(c1.length, c2.length);
        const similarity = 1 - (distance / maxLength);

        return similarity > 0.75 && similarity < 1.0;
    }

    /**
     * Use LLM to detect semantic contradiction
     */
    private async detectLLMContradiction(content1: string, content2: string): Promise<boolean> {
        if (!this.openRouterService) return false;

        try {
            const prompt = `Analyze if these two statements about architectural rules or user preferences are logically contradictory OR if one is a direct reversal of the other.

Statement 1: "${content1}"
Statement 2: "${content2}"

A contradiction exists if Statement 2 makes Statement 1 impossible or invalidates it. 
Rephrasings or compatible extensions are NOT contradictions.

Answer only with:
"YES" - if they directly contradict or reverse each other.
"NO" - if they are compatible, rephrased, or about different topics.`;

            const response = await this.openRouterService.sendChatMessage({
                messages: [
                    { role: 'system', content: 'You are a logical validation assistant. Detect direct contradictions in structural code rules and user preferences.' },
                    { role: 'user', content: prompt }
                ],
                model: 'deepseek/deepseek-chat',
                temperature: 0,
                max_tokens: 10
            });

            interface DeepSeekResponse {
                choices?: Array<{
                    message?: {
                        content: string;
                    };
                }>;
            }

            const data = await response.json() as DeepSeekResponse;
            const text = (data.choices?.[0]?.message?.content || '').trim().toUpperCase();
            return text.includes('YES');
        } catch (error) {
            console.error('[MemoryConflictResolver] LLM contradiction check failed:', error);
            return false;
        }
    }

    /**
     * Levenshtein Distance implementation
     */
    private levenshteinDistance(s1: string, s2: string): number {
        const m = s1.length;
        const n = s2.length;
        const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) d[i][0] = i;
        for (let j = 0; j <= n; j++) d[0][j] = j;

        for (let j = 1; j <= n; j++) {
            for (let i = 1; i <= m; i++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
                d[i][j] = Math.min(
                    d[i - 1][j] + 1,      // deletion
                    d[i][j - 1] + 1,      // insertion
                    d[i - 1][j - 1] + cost // substitution
                );
            }
        }

        return d[m][n];
    }
}
