import * as fs from 'fs/promises';
import * as path from 'path';
import { Memory, MemoryId } from './types';

export class MemoryPersistence {
    private memoriesPath: string;
    private backupPath: string;

    constructor(workspaceRoot: string) {
        this.memoriesPath = path.join(workspaceRoot, '.gently', 'memories.json');
        this.backupPath = path.join(workspaceRoot, '.gently', 'memories.json.bak');
    }

    /**
     * Initialize persistence directory
     */
    async ensureDirectory(): Promise<void> {
        const dir = path.dirname(this.memoriesPath);
        try {
            await fs.mkdir(dir, { recursive: true });
        } catch (error) {
            console.error('[MemoryPersistence] Error creating directory:', error);
        }
    }

    /**
     * Save memories to disk with backup
     */
    async save(memories: Map<MemoryId, Memory>): Promise<void> {
        try {
            // Create backup of current file if it exists
            try {
                await fs.copyFile(this.memoriesPath, this.backupPath);
            } catch (e) {
                // Ignore if file doesn't exist
            }

            const data = {
                version: '1.1',
                memories: Array.from(memories.values()),
                updatedAt: Date.now()
            };

            await fs.writeFile(this.memoriesPath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`[MemoryPersistence] Saved ${memories.size} memories to disk`);
        } catch (error) {
            console.error('[MemoryPersistence] Error saving memories:', error);
            throw error;
        }
    }

    /**
     * Load memories from disk
     */
    async load(): Promise<Memory[]> {
        try {
            const content = await fs.readFile(this.memoriesPath, 'utf-8');
            const data = JSON.parse(content);

            if (data.memories && Array.isArray(data.memories)) {
                return data.memories;
            }
            return [];
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return [];
            }

            // If primary file is corrupted, try backup
            console.warn('[MemoryPersistence] Error loading memories, trying backup...');
            try {
                const backupContent = await fs.readFile(this.backupPath, 'utf-8');
                const backupData = JSON.parse(backupContent);
                if (backupData.memories && Array.isArray(backupData.memories)) {
                    return backupData.memories;
                }
            } catch (backupError) {
                console.error('[MemoryPersistence] Backup loading failed:', backupError);
            }

            throw error;
        }
    }

    /**
     * Clear all memories on disk
     */
    async clear(): Promise<void> {
        try {
            await fs.unlink(this.memoriesPath);
            await fs.unlink(this.backupPath).catch(() => { });
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}
