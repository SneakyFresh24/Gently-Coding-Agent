import * as path from 'path';
import * as fs from 'fs';
import { FileOperations } from './fileOperations';

export interface RepoMapConfig {
    maxDepth?: number;
    excludePatterns?: string[];
}

export class CodebaseMapGenerator {
    private fileOps: FileOperations;
    private config: RepoMapConfig;

    constructor(fileOps: FileOperations, config: RepoMapConfig = {}) {
        this.fileOps = fileOps;
        this.config = {
            maxDepth: 5,
            excludePatterns: ['node_modules', 'dist', 'out', 'build', '.git', '.gently', 'coverage'],
            ...config
        };
    }

    /**
     * Generates a semantic representation of the codebase.
     */
    async generateMap(workspaceRoot: string): Promise<string> {
        const mapLines: string[] = ['# Workspace Semantic Map', ''];

        try {
            await this.scanDirectory(workspaceRoot, workspaceRoot, 0, mapLines);

            if (mapLines.length <= 2) {
                mapLines.push('> No parsed TypeScript/JavaScript files found.');
            }
            return mapLines.join('\n');
        } catch (error) {
            console.error('[CodebaseMapGenerator] Failed to generate map:', error);
            return '# Workspace Semantic Map\n\n> Failed to generate map due to error.';
        }
    }

    private async scanDirectory(
        currentDir: string,
        rootDir: string,
        depth: number,
        resultLines: string[]
    ): Promise<void> {
        if (depth > this.config.maxDepth!) return;

        try {
            const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

            // Sort entries: directories first, then files alphabetically
            entries.sort((a, b) => {
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

            for (const entry of entries) {
                if (this.config.excludePatterns?.some(pattern => entry.name.includes(pattern))) {
                    continue;
                }

                const fullPath = path.join(currentDir, entry.name);
                const relPath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                const indent = '  '.repeat(depth);

                if (entry.isDirectory()) {
                    // Add a structured folder notation
                    resultLines.push(`${indent}📁 ${entry.name}/`);
                    await this.scanDirectory(fullPath, rootDir, depth + 1, resultLines);
                } else if (this.isParseableFile(entry.name)) {
                    const fileInfo = await this.fileOps.readFile(fullPath);
                    const signatures = this.extractSignatures(fileInfo.content);

                    if (signatures.length > 0) {
                        resultLines.push(`${indent}📄 ${entry.name}`);
                        for (const sig of signatures) {
                            resultLines.push(`${indent}  ╰─ ${sig}`);
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore read errors for specific directories (e.g. permissions)
        }
    }

    private isParseableFile(filename: string): boolean {
        return filename.endsWith('.ts') ||
            filename.endsWith('.js') ||
            filename.endsWith('.tsx') ||
            filename.endsWith('.jsx');
    }

    /**
     * Extracts essential structural signatures from the file content using Regex.
     */
    private extractSignatures(content: string): string[] {
        const signatures: string[] = [];
        const lines = content.split('\n');

        const classRegex = /export\s+(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)/;
        const interfaceRegex = /export\s+interface\s+([a-zA-Z0-9_]+)/;
        const typeRegex = /export\s+type\s+([a-zA-Z0-9_]+)/;
        const functionRegex = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_]+)/;
        const constFunctionRegex = /export\s+const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            const classMatch = line.match(classRegex);
            if (classMatch) {
                signatures.push(`Class: ${classMatch[1]}`);
                continue;
            }

            const interfaceMatch = line.match(interfaceRegex);
            if (interfaceMatch) {
                signatures.push(`Interface: ${interfaceMatch[1]}`);
                continue;
            }

            const typeMatch = line.match(typeRegex);
            if (typeMatch) {
                signatures.push(`Type: ${typeMatch[1]}`);
                continue;
            }

            const functionMatch = line.match(functionRegex);
            if (functionMatch) {
                signatures.push(`Function: ${functionMatch[1]}`);
                continue;
            }

            const constFuncMatch = line.match(constFunctionRegex);
            if (constFuncMatch) {
                signatures.push(`Function: ${constFuncMatch[1]}`);
                continue;
            }
        }

        return signatures;
    }
}
