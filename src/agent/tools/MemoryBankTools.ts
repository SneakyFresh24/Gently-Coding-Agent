import { MemoryBankManager } from '../memory/MemoryBankManager';
import { ToolRegistry } from './ToolRegistry';

export class MemoryBankTools {
    constructor(private memoryBankManager: MemoryBankManager) { }

    /**
     * Register all memory bank related tools
     */
    registerTools(registry: ToolRegistry): void {
        registry.register('update_memory_bank', this.updateMemoryBank.bind(this));
        registry.register('query_long_term_memory', this.queryLongTermMemory.bind(this));
    }

    private async updateMemoryBank(params: any): Promise<any> {
        try {
            console.log(`[MemoryBankTools] update_memory_bank called for ${params.filename}`);
            await this.memoryBankManager.writeMemoryBank(params.filename, params.content);
            return {
                success: true,
                message: `Memory bank file '${params.filename}' has been successfully updated and saved.`
            };
        } catch (error) {
            console.error('[MemoryBankTools] Error updating memory bank:', error);
            return {
                success: false,
                message: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    private async queryLongTermMemory(params: any): Promise<any> {
        try {
            if (params.filename) {
                const file = await this.memoryBankManager.getMemoryBank(params.filename);
                if (!file) {
                    return { success: false, message: `Memory bank file '${params.filename}' not found.` };
                }
                return {
                    success: true,
                    filename: file.name,
                    content: file.content
                };
            } else {
                const files = await this.memoryBankManager.getAllMemoryBanks();
                return {
                    success: true,
                    files: files.map(f => ({ filename: f.name, content: f.content }))
                };
            }
        } catch (error) {
            console.error('[MemoryBankTools] Error querying long term memory:', error);
            return {
                success: false,
                message: `Error: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }
}
