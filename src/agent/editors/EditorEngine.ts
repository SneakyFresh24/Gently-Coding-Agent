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
import { fileExists, readFileAsync, copyFileAsync, safeWriteFile } from '../../utils/persistenceUtils';
import { FileOperations } from '../fileOperations';
import { ASTAnalyzer } from '../ASTAnalyzer';

export interface HunkEdit {
    id: string;
    oldContent: string;
    newContent: string;
    startLineHint?: number;
    endLineHint?: number;
    contextBefore?: string;
    contextAfter?: string;
    reason: string;
}

export interface MultiHunkEditRequest {
    filePath: string;
    mode: 'atomic' | 'best-effort';
    previewOnly: boolean;
    edits: HunkEdit[];
}

export interface FailedHunk {
    id: string;
    reason: string;
    suggestedFix: string;
}

export interface MultiHunkEditResult {
    success: boolean;
    appliedCount: number;
    failedCount: number;
    appliedHunks: string[];
    failedHunks: FailedHunk[];
    previewDiffs?: { id: string, filePath: string, diff: string }[];
    error?: string;
}

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
        private astAnalyzer: ASTAnalyzer
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

    // ── Multi-Hunk Block Editing ──

    private normalizeForMatching(content: string): string {
        return content
            .replace(/\\r\\n/g, '\\n')
            .replace(/[ \\t]+$/gm, '') // Trailing whitespace
            .trim();
    }

    private generateBasicDiff(oldContent: string, newContent: string): string {
        // A simple placeholder diff generator
        const oldLines = oldContent.split('\\n');
        const newLines = newContent.split('\\n');
        let diff = '';
        oldLines.forEach(l => diff += `- ${l}\n`);
        newLines.forEach(l => diff += `+ ${l}\n`);
        return diff;
    }

    async applyHunkEditsSafely(request: MultiHunkEditRequest): Promise<MultiHunkEditResult> {
        const workspaceRoot = this.fileOps.getWorkspaceRoot();
        const absolutePath = path.isAbsolute(request.filePath) ? request.filePath : path.join(workspaceRoot, request.filePath);
        const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\\\/g, '/');

        if (!(await fileExists(absolutePath))) {
            return {
                success: false, appliedCount: 0, failedCount: request.edits.length,
                appliedHunks: [], failedHunks: request.edits.map(h => ({ id: h.id, reason: `File not found: ${relativePath}`, suggestedFix: "Check the path" }))
            };
        }

        const originalContent = await readFileAsync(absolutePath);
        const fileContentStr = originalContent; // original normalized string
        let currentContentStr = fileContentStr;
        
        const result: MultiHunkEditResult = {
            success: false, appliedCount: 0, failedCount: 0,
            appliedHunks: [], failedHunks: [], previewDiffs: []
        };

        // Conflict Detection (Simple overlap check)
        const hints = request.edits.map(h => ({ id: h.id, start: h.startLineHint || 0, end: h.endLineHint || Number.MAX_SAFE_INTEGER }));
        for (let i = 0; i < hints.length; i++) {
            for (let j = i + 1; j < hints.length; j++) {
                if (hints[i].start > 0 && hints[j].start > 0 && Math.max(hints[i].start, hints[j].start) <= Math.min(hints[i].end, hints[j].end)) {
                    // Possible overlap detected, could log a warning here.
                }
            }
        }

        // To safely apply multiple hunks, we should process them in reverse order to avoid line shifting.
        // We first find the match indices for all hunks.
        const matches: Array<{ hunk: HunkEdit, startIndex: number, endIndex: number, exactOld: string }> = [];

        for (const hunk of request.edits) {
            const normOld = this.normalizeForMatching(hunk.oldContent);
            const contentLines = currentContentStr.split('\\n');
            const normLines = contentLines.map(l => this.normalizeForMatching(l));
            
            // 1. Exact Substring Search using sliding window of lines
            const searchLines = normOld.split('\\n');
            let found = false;
            let bestMatchLine = -1;

            // Simple exact match logic:
            if (searchLines.length > 0 && normOld.length > 0) {
                for (let i = 0; i <= normLines.length - searchLines.length; i++) {
                    let match = true;
                    // Fast path exact
                    for (let j = 0; j < searchLines.length; j++) {
                        if (normLines[i + j] !== searchLines[j]) {
                            match = false; break;
                        }
                    }
                    if (match) {
                        // Score this match (closer to hint is better)
                        if (bestMatchLine === -1 || (hunk.startLineHint && Math.abs(i - (hunk.startLineHint - 1)) < Math.abs(bestMatchLine - (hunk.startLineHint - 1)))) {
                            bestMatchLine = i;
                        }
                    }
                }
            }

            if (bestMatchLine !== -1) {
                matches.push({
                    hunk,
                    startIndex: bestMatchLine,
                    endIndex: bestMatchLine + searchLines.length - 1,
                    exactOld: contentLines.slice(bestMatchLine, bestMatchLine + searchLines.length).join('\\n')
                });
            } else {
                // Fuzzy fallback could go here
                result.failedHunks.push({
                    id: hunk.id,
                    reason: "old_content mismatch after normalization",
                    suggestedFix: "Check indentation/whitespace, or ensure the snippet exactly matches the latest file state."
                });
                result.failedCount++;
            }
        }

        if (request.previewOnly) {
            for (const match of matches) {
                result.previewDiffs!.push({
                    id: match.hunk.id,
                    filePath: relativePath,
                    diff: this.generateBasicDiff(match.exactOld, match.hunk.newContent)
                });
            }
            // For failed ones, perhaps no diff
            result.success = result.failedCount === 0; // True if all "proposed" matching works
            return result;
        }

        // Sort matches by startIndex descending (reverse order application)
        matches.sort((a, b) => b.startIndex - a.startIndex);

        // Backup before atomic apply
        const backupPath = absolutePath + '.bak-' + Date.now();
        if (matches.length > 0) {
            await copyFileAsync(absolutePath, backupPath);
        }

        let tempContentLines = currentContentStr.split('\\n');
        
        // Execute replacements
        for (const match of matches) {
            const newSnippetLines = match.hunk.newContent.split('\\n');
            tempContentLines.splice(match.startIndex, match.endIndex - match.startIndex + 1, ...newSnippetLines);
            result.appliedHunks.push(match.hunk.id);
            result.appliedCount++;
        }

        if (request.mode === 'atomic' && result.failedCount > 0) {
            // Rollback
            result.success = false;
            result.appliedHunks = [];
            result.appliedCount = 0;
            // No file ops necessary as we haven't written yet.
        } else if (result.appliedCount > 0) {
            // Commit changes
            await safeWriteFile(absolutePath, tempContentLines.join('\n'));
            result.success = true;
        } else {
            result.success = false;
        }

        return result;
    }
}
