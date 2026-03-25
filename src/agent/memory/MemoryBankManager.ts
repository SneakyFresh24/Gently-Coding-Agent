import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface MemoryBankFile {
    name: string;
    content: string;
}

export class MemoryBankManager {
    private workspaceRoot: string;
    private memoryBankPath: string;
    private isInitialized: boolean = false;
    private contextCache: { value: string; createdAt: number } | null = null;
    private inFlightFormattedContext: Promise<string> | null = null;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.memoryBankPath = path.join(workspaceRoot, '.gently', 'memory-bank');
    }

    invalidateCache(): void {
        this.contextCache = null;
    }

    private getCacheTtlMs(): number {
        const configured = vscode.workspace.getConfiguration('gently').get<number>('performance.memoryBankCacheTtlMs', 30000);
        if (!Number.isFinite(configured)) return 30000;
        const normalized = Math.floor(Number(configured));
        return normalized > 0 ? normalized : 30000;
    }

    /**
     * Initializes the memory bank directory
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            await fs.mkdir(this.memoryBankPath, { recursive: true });
            this.isInitialized = true;
            console.log('[MemoryBankManager] Initialized memory bank at', this.memoryBankPath);
        } catch (error) {
            console.error('[MemoryBankManager] Error creating memory bank directory:', error);
        }
    }

    /**
     * Reads all memory bank markdown files
     */
    async getAllMemoryBanks(): Promise<MemoryBankFile[]> {
        await this.initialize();

        try {
            const files = await fs.readdir(this.memoryBankPath);
            const markdownFiles = files.filter(f => f.endsWith('.md'));

            const banks: MemoryBankFile[] = [];
            for (const file of markdownFiles) {
                const filePath = path.join(this.memoryBankPath, file);
                const content = await fs.readFile(filePath, 'utf-8');
                banks.push({ name: file, content });
            }
            return banks;
        } catch (error) {
            console.error('[MemoryBankManager] Error reading memory banks:', error);
            return [];
        }
    }

    /**
     * Gets a specific memory bank file
     */
    async getMemoryBank(filename: string): Promise<MemoryBankFile | null> {
        await this.initialize();

        // Ensure .md extension
        if (!filename.endsWith('.md')) {
            filename += '.md';
        }

        const filePath = path.join(this.memoryBankPath, filename);
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return { name: filename, content };
        } catch (error) {
            return null;
        }
    }

    /**
     * Writes or overwrites a memory bank file
     */
    async writeMemoryBank(filename: string, content: string): Promise<void> {
        await this.initialize();

        // Ensure .md extension
        if (!filename.endsWith('.md')) {
            filename += '.md';
        }

        const filePath = path.join(this.memoryBankPath, filename);
        try {
            await fs.writeFile(filePath, content, 'utf-8');
            this.invalidateCache();
            console.log(`[MemoryBankManager] Wrote memory bank file: ${filename}`);
        } catch (error) {
            console.error('[MemoryBankManager] Error writing memory bank:', error);
            throw new Error(`Failed to write memory bank ${filename}: ${error}`);
        }
    }

    /**
     * Appends content to a memory bank file
     */
    async appendMemoryBank(filename: string, content: string): Promise<void> {
        await this.initialize();

        // Ensure .md extension
        if (!filename.endsWith('.md')) {
            filename += '.md';
        }

        const filePath = path.join(this.memoryBankPath, filename);
        try {
            let exists = false;
            try {
                await fs.access(filePath);
                exists = true;
            } catch (e) {
                exists = false;
            }

            const appendContent = exists ? `\n\n---\n\n${content}` : content;
            await fs.appendFile(filePath, appendContent, 'utf-8');
            this.invalidateCache();
            console.log(`[MemoryBankManager] Appended to memory bank file: ${filename}`);
        } catch (error) {
            console.error('[MemoryBankManager] Error appending to memory bank:', error);
            throw new Error(`Failed to append to memory bank ${filename}: ${error}`);
        }
    }

    /**
     * Formats all memory bank files into a single context string
     */
    async getFormattedContext(options: { includeHeader?: boolean; compact?: boolean } = {}): Promise<string> {
        const canCache = options.includeHeader !== false && !options.compact;
        const ttlMs = this.getCacheTtlMs();
        const now = Date.now();
        if (canCache && this.contextCache && (now - this.contextCache.createdAt) < ttlMs) {
            console.log(JSON.stringify({
                'perf.phase': 'memory_bank_context',
                cache_hit: true,
                duration_ms: 0
            }));
            return this.contextCache.value;
        }

        if (canCache && this.inFlightFormattedContext) {
            return this.inFlightFormattedContext;
        }

        const run = async (): Promise<string> => {
            const start = Date.now();
        const banks = await this.getAllMemoryBanks();
        if (banks.length === 0) {
            if (canCache) {
                this.contextCache = { value: '', createdAt: Date.now() };
            }
            console.log(JSON.stringify({
                'perf.phase': 'memory_bank_context',
                cache_hit: false,
                duration_ms: Date.now() - start
            }));
            return '';
        }

        let structuredContext = '';
        if (options.includeHeader !== false) {
            structuredContext = '==== LONG TERM MEMORY BANK (Tier-1 Context) ====\n\n';
            structuredContext += 'These files represent persistent project facts, architecture decisions, and current focus rules.\n\n';
        }

        for (const bank of banks) {
            if (options.compact) {
                structuredContext += `[${bank.name}]\n${bank.content.substring(0, 500)}${bank.content.length > 500 ? '...' : ''}\n\n`;
            } else {
                structuredContext += `--- BEGIN FILEDETAILS: ${bank.name} ---\n`;
                structuredContext += `${bank.content}\n`;
                structuredContext += `--- END FILEDETAILS ---\n\n`;
            }
        }

            if (canCache) {
                this.contextCache = { value: structuredContext, createdAt: Date.now() };
            }
            console.log(JSON.stringify({
                'perf.phase': 'memory_bank_context',
                cache_hit: false,
                duration_ms: Date.now() - start
            }));
        return structuredContext;
        };

        if (!canCache) {
            return run();
        }

        this.inFlightFormattedContext = run();
        try {
            return await this.inFlightFormattedContext;
        } finally {
            this.inFlightFormattedContext = null;
        }
    }
}
