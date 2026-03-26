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
import { Mutex } from '../../core/state/Mutex';

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
    matchCount?: number;
    candidateRanges?: Array<{ startLine: number; endLine: number }>;
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
    allowFuzzy?: boolean;
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
    private readonly fileLocks = new Map<string, Mutex>();

    constructor(
        private fileOps: FileOperations,
        private astAnalyzer: ASTAnalyzer
    ) { }

    async executeEdit(request: EditRequest): Promise<EditResult> {
        const { filePath, anchorLine, newContent, endAnchor, lineNumberHint, symbolName, preview, allowFuzzy } = request;

        return this.withFileLock(filePath, async () => {
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

                // 3. Anchor-based
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

                // 4. Optional fuzzy fallback
                if (startIndex === -1 && anchorLine && allowFuzzy === true) {
                    startIndex = this.findFuzzyAnchor(lines, anchorLine);
                    if (startIndex !== -1) {
                        strategy = 'fuzzy';
                        endIndex = startIndex;
                    }
                }

                if (startIndex === -1) {
                    const fuzzyHint = allowFuzzy === true
                        ? ''
                        : ' Fuzzy matching is disabled by default (set allow_fuzzy=true to opt in).';
                    return {
                        success: false,
                        message: `No match found with deterministic strategies in ${relativePath}.`,
                        error: `Anchor/Symbol not found: ${anchorLine || symbolName}.${fuzzyHint}`
                    };
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
        });
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
            .replace(/\r\n/g, '\n')
            .replace(/[ \\t]+$/gm, '') // Trailing whitespace
            .trim();
    }

    private normalizeLineForTrimMatch(line: string): string {
        return line.replace(/\r/g, '').trim();
    }

    private generateBasicDiff(oldContent: string, newContent: string): string {
        // A simple placeholder diff generator
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');
        let diff = '';
        oldLines.forEach(l => diff += `- ${l}\n`);
        newLines.forEach(l => diff += `+ ${l}\n`);
        return diff;
    }

    async applyHunkEditsSafely(request: MultiHunkEditRequest): Promise<MultiHunkEditResult> {
        return this.withFileLock(request.filePath, async () => {
            const workspaceRoot = this.fileOps.getWorkspaceRoot();
            const absolutePath = path.isAbsolute(request.filePath) ? request.filePath : path.join(workspaceRoot, request.filePath);
            const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');

            if (!(await fileExists(absolutePath))) {
                return {
                    success: false, appliedCount: 0, failedCount: request.edits.length,
                    appliedHunks: [], failedHunks: request.edits.map(h => ({ id: h.id, reason: `File not found: ${relativePath}`, suggestedFix: 'Check the path' }))
                };
            }

            const originalContent = await readFileAsync(absolutePath);
            const result: MultiHunkEditResult = {
                success: false, appliedCount: 0, failedCount: 0,
                appliedHunks: [], failedHunks: [], previewDiffs: []
            };

            // Phase A: Validate matches in input order (forward)
            const matches: Array<{ hunk: HunkEdit, startIndex: number, endIndex: number, exactOld: string }> = [];
            let lastProcessedIndex = -1;
            const contentLines = originalContent.split('\n');

            for (const hunk of request.edits) {
                const resolution = this.resolveHunkMatch(contentLines, hunk, lastProcessedIndex);
                if (!resolution.ok) {
                    result.failedHunks.push({
                        id: hunk.id,
                        reason: resolution.reason,
                        suggestedFix: resolution.suggestedFix,
                        matchCount: resolution.matchCount,
                        candidateRanges: resolution.candidateRanges
                    });
                    result.failedCount++;
                    continue;
                }

                matches.push({
                    hunk,
                    startIndex: resolution.startIndex,
                    endIndex: resolution.endIndex,
                    exactOld: contentLines.slice(resolution.startIndex, resolution.endIndex + 1).join('\n')
                });
                lastProcessedIndex = resolution.endIndex;
            }

            if (request.previewOnly) {
                for (const match of matches) {
                    result.previewDiffs!.push({
                        id: match.hunk.id,
                        filePath: relativePath,
                        diff: this.generateBasicDiff(match.exactOld, match.hunk.newContent)
                    });
                }
                result.success = result.failedCount === 0;
                return result;
            }

            // In atomic mode, any validation failure aborts all applies.
            if (request.mode === 'atomic' && result.failedCount > 0) {
                result.success = false;
                return result;
            }

            // Phase B: Apply matches in reverse order to avoid line shifts.
            matches.sort((a, b) => b.startIndex - a.startIndex);
            const tempContentLines = originalContent.split('\n');

            if (matches.length > 0) {
                const backupPath = absolutePath + '.bak-' + Date.now();
                await copyFileAsync(absolutePath, backupPath);
            }

            for (const match of matches) {
                const newSnippetLines = match.hunk.newContent.split('\n');
                tempContentLines.splice(match.startIndex, match.endIndex - match.startIndex + 1, ...newSnippetLines);
                result.appliedHunks.push(match.hunk.id);
                result.appliedCount++;
            }

            if (result.appliedCount > 0) {
                await safeWriteFile(absolutePath, tempContentLines.join('\n'));
                result.success = result.failedCount === 0 || request.mode !== 'atomic';
            } else {
                result.success = false;
            }

            return result;
        });
    }

    private resolveHunkMatch(
        contentLines: string[],
        hunk: HunkEdit,
        lastProcessedIndex: number
    ): (
        | { ok: true; startIndex: number; endIndex: number }
        | { ok: false; reason: string; suggestedFix: string; matchCount?: number; candidateRanges?: Array<{ startLine: number; endLine: number }> }
    ) {
        const oldLines = hunk.oldContent.split('\n');
        if (oldLines.length === 0 || (oldLines.length === 1 && oldLines[0] === '')) {
            return {
                ok: false,
                reason: 'old_content is empty.',
                suggestedFix: 'Provide a non-empty old_content block.'
            };
        }

        const exactCandidates = this.findSequenceMatches(contentLines, oldLines, 'exact');
        if (exactCandidates.length === 1) {
            return this.enforceForwardOrder(exactCandidates[0], lastProcessedIndex);
        }
        if (exactCandidates.length > 1 && !hunk.contextBefore && !hunk.contextAfter) {
            return this.multipleMatchFailure('Exact match is ambiguous.', exactCandidates);
        }

        const trimCandidates = this.findSequenceMatches(contentLines, oldLines, 'trim');
        if (trimCandidates.length === 1) {
            return this.enforceForwardOrder(trimCandidates[0], lastProcessedIndex);
        }
        if (trimCandidates.length > 1 && !hunk.contextBefore && !hunk.contextAfter) {
            return this.multipleMatchFailure('Trim-normalized match is ambiguous.', trimCandidates);
        }

        const contextBaseCandidates = exactCandidates.length > 1
            ? exactCandidates
            : trimCandidates;
        const contextCandidates = this.filterByContext(contentLines, contextBaseCandidates, hunk.contextBefore, hunk.contextAfter);
        if (contextCandidates.length === 1) {
            return this.enforceForwardOrder(contextCandidates[0], lastProcessedIndex);
        }
        if (contextCandidates.length > 1) {
            return this.multipleMatchFailure('Context-anchored match is ambiguous.', contextCandidates);
        }

        return {
            ok: false,
            reason: 'old_content mismatch after exact/trim/context matching.',
            suggestedFix: 'Ensure old_content matches exactly or provide context_before/context_after to disambiguate.'
        };
    }

    private enforceForwardOrder(
        candidate: { startIndex: number; endIndex: number },
        lastProcessedIndex: number
    ): { ok: true; startIndex: number; endIndex: number } | { ok: false; reason: string; suggestedFix: string } {
        if (candidate.startIndex <= lastProcessedIndex) {
            return {
                ok: false,
                reason: `Out-of-order hunk: candidate starts at line ${candidate.startIndex + 1}, but previous hunk ended at line ${lastProcessedIndex + 1}.`,
                suggestedFix: 'Reorder hunks to follow file order, top-to-bottom.'
            };
        }
        return { ok: true, startIndex: candidate.startIndex, endIndex: candidate.endIndex };
    }

    private multipleMatchFailure(
        reason: string,
        candidates: Array<{ startIndex: number; endIndex: number }>
    ): { ok: false; reason: string; suggestedFix: string; matchCount: number; candidateRanges: Array<{ startLine: number; endLine: number }> } {
        return {
            ok: false,
            reason,
            suggestedFix: 'Provide context_before/context_after to make the match unique.',
            matchCount: candidates.length,
            candidateRanges: candidates.map((c) => ({ startLine: c.startIndex + 1, endLine: c.endIndex + 1 }))
        };
    }

    private findSequenceMatches(
        contentLines: string[],
        searchLines: string[],
        mode: 'exact' | 'trim'
    ): Array<{ startIndex: number; endIndex: number }> {
        const candidates: Array<{ startIndex: number; endIndex: number }> = [];
        if (searchLines.length === 0 || contentLines.length < searchLines.length) {
            return candidates;
        }

        const normalize = (line: string) => mode === 'trim' ? this.normalizeLineForTrimMatch(line) : line.replace(/\r/g, '');
        const normalizedSearch = searchLines.map(normalize);

        for (let i = 0; i <= contentLines.length - normalizedSearch.length; i++) {
            let match = true;
            for (let j = 0; j < normalizedSearch.length; j++) {
                if (normalize(contentLines[i + j]) !== normalizedSearch[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                candidates.push({ startIndex: i, endIndex: i + normalizedSearch.length - 1 });
            }
        }

        return candidates;
    }

    private filterByContext(
        contentLines: string[],
        candidates: Array<{ startIndex: number; endIndex: number }>,
        contextBefore?: string,
        contextAfter?: string
    ): Array<{ startIndex: number; endIndex: number }> {
        if (!contextBefore && !contextAfter) {
            return candidates;
        }

        const normalizedContextBefore = contextBefore ? this.normalizeForMatching(contextBefore) : '';
        const normalizedContextAfter = contextAfter ? this.normalizeForMatching(contextAfter) : '';

        return candidates.filter((candidate) => {
            let beforeOk = true;
            let afterOk = true;

            if (normalizedContextBefore) {
                const beforeWindow = contentLines.slice(Math.max(0, candidate.startIndex - 12), candidate.startIndex).join('\n');
                beforeOk = this.normalizeForMatching(beforeWindow).includes(normalizedContextBefore);
            }

            if (normalizedContextAfter) {
                const afterWindow = contentLines.slice(candidate.endIndex + 1, Math.min(contentLines.length, candidate.endIndex + 13)).join('\n');
                afterOk = this.normalizeForMatching(afterWindow).includes(normalizedContextAfter);
            }

            return beforeOk && afterOk;
        });
    }

    private async withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
        const key = filePath.replace(/\\/g, '/').toLowerCase();
        let mutex = this.fileLocks.get(key);
        if (!mutex) {
            mutex = new Mutex();
            this.fileLocks.set(key, mutex);
        }
        return mutex.runExclusive(fn);
    }
}
