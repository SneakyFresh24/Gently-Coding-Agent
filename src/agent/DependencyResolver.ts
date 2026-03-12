import * as path from 'path';
import { CodeChunk } from './ASTAnalyzer';
import { CodebaseIndexer } from './CodebaseIndexer';

export interface ResolvedDependency {
    sourceChunkId: string;
    sourceFilePath: string;
    targetChunkId: string;
    targetFilePath: string;
    symbolName: string;
}

export class DependencyResolver {
    private indexer: CodebaseIndexer;

    // Map of symbolName -> { filePath, chunkId }
    private globalSymbolMap: Map<string, { filePath: string, chunkId: string }[]> = new Map();

    constructor(indexer: CodebaseIndexer) {
        this.indexer = indexer;
    }

    /**
     * Build a global registry of all exported/top-level symbols from all files
     */
    public buildGlobalMap(allChunksByFile: Map<string, CodeChunk[]>) {
        this.globalSymbolMap.clear();

        for (const [filePath, chunks] of allChunksByFile.entries()) {
            for (const chunk of chunks) {
                // Only register top-level symbols (no dots in ID) or specific class methods if needed
                if (!chunk.id.includes('.')) {
                    const entry = { filePath, chunkId: chunk.id };
                    const existing = this.globalSymbolMap.get(chunk.name) || [];
                    existing.push(entry);
                    this.globalSymbolMap.set(chunk.name, existing);
                }
            }
        }
    }

    /**
     * Resolve dependencies for a specific file's chunks
     */
    public resolveDependencies(filePath: string, chunks: CodeChunk[]): ResolvedDependency[] {
        const fileIndex = this.indexer.getFileIndex(filePath);
        const resolved: ResolvedDependency[] = [];

        // Map of imported modules for this file (from the CodebaseIndexer)
        // The indexer's `imports` array is just a list of module paths like '../CodebaseMapGenerator'
        const importedModules = fileIndex ? fileIndex.imports : [];

        for (const chunk of chunks) {
            for (const dep of chunk.dependencies) {
                // Skip self-references
                if (dep === chunk.name) continue;

                const targets = this.globalSymbolMap.get(dep);
                if (targets && targets.length > 0) {
                    // Find the best match
                    let bestTarget = targets.find(t => t.filePath === filePath); // Local file takes precedence

                    if (!bestTarget) {
                        // Look for a target whose filepath matches one of our imports
                        bestTarget = targets.find(t => {
                            return importedModules.some(imp => {
                                // Remove relative prefixes (e.g., '../', './') and extensions
                                const impClean = imp.replace(/^(\.\.\/|\.\/)+/, '').replace(/\.(ts|js|tsx|jsx)$/, '');
                                const targetClean = t.filePath.replace(/\\/g, '/').replace(/\.(ts|js|tsx|jsx)$/, '');

                                // Check if target path ends with the imported path (handles deep imports)
                                return targetClean.endsWith(impClean);
                            });
                        });
                    }

                    // Fallback to first target if not unambiguously matched by imports (could be a global)
                    if (!bestTarget) bestTarget = targets[0];

                    resolved.push({
                        sourceChunkId: chunk.id,
                        sourceFilePath: filePath,
                        targetChunkId: bestTarget.chunkId,
                        targetFilePath: bestTarget.filePath,
                        symbolName: dep
                    });
                }
            }
        }

        // Deduplicate
        const unique = new Map<string, ResolvedDependency>();
        for (const res of resolved) {
            const key = `${res.sourceChunkId}->${res.targetChunkId}`;
            if (!unique.has(key)) {
                unique.set(key, res);
            }
        }

        return Array.from(unique.values());
    }
}
