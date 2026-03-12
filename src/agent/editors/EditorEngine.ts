/**
 * EditorEngine - Intelligent Unified File Editor (FINAL 10/10)
 * 
 * Strategies in order of priority:
 * 1. Explicit line range
 * 2. AST symbol matching
 * 3. Anchor-based (start + optional end)
 * 4. Fuzzy fallback
 */

import * as path from 'path';
import { fileExists, readFileAsync, copyFileAsync } from '../../utils/persistenceUtils';
import { FileOperations } from '../fileOperations';
import { ASTAnalyzer } from '../ASTAnalyzer';
import { GuardianService } from '../../guardian/GuardianService';

export interface EditRequest {
    filePath: string;
    anchorLine?: string;
    newContent: string;
    endAnchor?: string;
    lineNumberHint?: number;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    preview?: boolean;
}

export interface EditResult {
    success: boolean;
    message: string;
    diff?: string;
    backupPath?: string;
    error?: string;
    path?: string;
    strategy?: string;
    hint?: string;
}

export class EditorEngine {
    constructor(
        private fileOps: FileOperations,
        private astAnalyzer: ASTAnalyzer,
        private guardian?: GuardianService
    ) { }

    async executeEdit(request: EditRequest): Promise<EditResult> {
        const { filePath, anchorLine, newContent, endAnchor, lineNumberHint, symbolName, preview } = request;

        try {
            const workspaceRoot = this.fileOps.getWorkspaceRoot();
            const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
            const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');

            if (!(await fileExists(absolutePath))) {
                return { success: false, message: `File not found: ${absolutePath}` };
            }

            const originalContent = await readFileAsync(absolutePath);
            const lines = originalContent.split('\n');

            // === STRATEGY LOOP ===
            let startIndex = -1;
            let endIndex = -1;
            let strategy = 'unknown';

            // 1. Explicit line range
            if (request.startLine !== undefined && request.endLine !== undefined) {
                startIndex = request.startLine - 1;
                endIndex = request.endLine - 1;
                strategy = 'line-range';
            }

            // 2. AST Symbol
            if (startIndex === -1 && symbolName) {
                const chunks = await this.astAnalyzer.analyzeFile(relativePath, originalContent);
                const match = chunks.find(c => c.id === symbolName || c.name === symbolName);
                if (match) {
                    startIndex = match.startLine - 1;
                    endIndex = match.endLine - 1;
                    strategy = 'ast';
                }
            }

            // 3. Anchor-based (dein SafeEdit-Kern)
            if (startIndex === -1 && anchorLine) {
                startIndex = this.findAnchorLine(lines, anchorLine, lineNumberHint);
                if (startIndex !== -1) {
                    strategy = 'anchor';
                    endIndex = startIndex;
                    if (endAnchor) {
                        endIndex = this.findAnchorLine(lines, endAnchor, undefined, startIndex + 1);
                    }
                }
            }

            // 4. Fuzzy fallback
            if (startIndex === -1 && anchorLine) {
                startIndex = this.findFuzzyAnchor(lines, anchorLine);
                if (startIndex !== -1) {
                    strategy = 'fuzzy';
                    endIndex = startIndex;
                }
            }

            if (startIndex === -1) {
                return { success: false, message: `No match found with any strategy in ${relativePath}`, error: `Anchor/Symbol not found: ${anchorLine || symbolName}` };
            }

            // Preview-Modus
            if (preview) {
                return { success: true, message: `Preview ready (strategy: ${strategy})`, path: relativePath };
            }

            // Backup + Edit
            const backupPath = absolutePath + '.bak-' + Date.now();
            await copyFileAsync(absolutePath, backupPath);

            await this.fileOps.editFile({
                filePath: relativePath,
                startLine: startIndex,
                endLine: endIndex,
                newContent: newContent
            });

            const oldLines = endIndex - startIndex + 1;
            const newLines = newContent.split('\n').length;

            return {
                success: true,
                message: `✅ Edit applied (${strategy} strategy). Lines ${startIndex + 1}-${endIndex + 1} replaced.`,
                path: relativePath,
                backupPath: path.basename(backupPath),
                diff: `-${oldLines} / +${newLines} lines`
            };

        } catch (error: any) {
            return { success: false, message: `Edit failed`, error: error.message };
        }
    }

    // ── Verbesserte Anchor-Suche (genau das, was dein CSS-Problem löst) ──
    private findAnchorLine(lines: string[], anchor: string, hint?: number, startFrom = 0): number {
        const trimmed = anchor.trim();
        const matches: number[] = [];

        for (let i = startFrom; i < lines.length; i++) {
            const line = lines[i].trim();

            // Verbesserte Matching-Logik (genau für CSS)
            if (line.startsWith(trimmed) ||
                line.includes(trimmed) ||
                (trimmed.length > 20 && line.includes(trimmed.substring(0, 20)))) {
                matches.push(i);
            }
        }

        if (matches.length === 0) return -1;
        if (matches.length === 1) return matches[0];

        // Hint-Priorität (dein CSS-Fall)
        if (hint !== undefined) {
            const hintIndex = hint - 1;
            if (matches.includes(hintIndex)) return hintIndex;

            // Closest match (wichtig bei identischen Selektoren)
            return matches.reduce((prev, curr) =>
                Math.abs(curr - hintIndex) < Math.abs(prev - hintIndex) ? curr : prev
            );
        }

        return matches[0];
    }

    private findFuzzyAnchor(lines: string[], anchor: string): number {
        const words = anchor.trim().toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (let i = 0; i < lines.length; i++) {
            const lineLower = lines[i].toLowerCase();
            const matchCount = words.filter(w => lineLower.includes(w)).length;
            if (matchCount / words.length >= 0.8) return i;
        }
        return -1;
    }
}
