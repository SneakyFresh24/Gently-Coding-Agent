import { HNSWIndex } from '../retrieval';
import { Memory, MemoryId } from './types';
import * as path from 'path';

export class MemoryVectorStore {
    private vectorIndex: HNSWIndex;

    constructor(workspaceRoot: string) {
        this.vectorIndex = new HNSWIndex({
            dimensions: 384, // Standard for BGE-Small/M3
            persistenceDir: path.join(workspaceRoot, '.gently', 'memory-index'),
            quantize: 'float32'
        });
    }

    /**
     * Add memory to vector index
     */
    async add(memory: Memory): Promise<void> {
        if (!memory.embedding) {
            return;
        }

        await this.vectorIndex.addDocument({
            id: memory.id,
            content: memory.content,
            embedding: memory.embedding,
            language: 'text',
            metadata: {
                category: memory.category,
                tags: memory.metadata.tags
            }
        });
    }

    /**
     * Search for similar memories
     */
    async search(queryEmbedding: number[], limit: number): Promise<any[]> {
        return this.vectorIndex.search(queryEmbedding, limit);
    }

    /**
     * Remove memory from vector index
     */
    async remove(id: MemoryId): Promise<void> {
        await this.vectorIndex.removeDocument(id);
    }

    /**
     * Clear the index
     */
    async clear(): Promise<void> {
        await this.vectorIndex.clear();
    }
}
