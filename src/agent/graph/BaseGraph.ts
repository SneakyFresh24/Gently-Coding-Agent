/**
 * Base Graph - Abstract base class for Call Graph and Import Graph
 * 
 * Provides shared logic for:
 * - Forward and reverse indexing
 * - Symbol management
 * - Transitive closure (DFS) with memoization
 * - Incremental clearing per file
 */

import {
    SymbolDefinition,
    FilePath,
    SymbolName,
    FullSymbolIdentifier
} from './types';

export abstract class BaseGraph<TRelation> {
    // Forward index: sourceKey -> Set of relations
    protected forwardGraph: Map<string, Set<TRelation>> = new Map();

    // Reverse index: targetKey -> Set of relations
    protected reverseGraph: Map<string, Set<TRelation>> = new Map();

    // Symbol definitions: symbol key -> definition
    protected symbols: Map<FullSymbolIdentifier, SymbolDefinition> = new Map();

    // File to symbols mapping: file -> Set of symbol names
    protected fileSymbols: Map<FilePath, Set<SymbolName>> = new Map();

    // Memoization cache for transitive queries
    private memoCache: Map<string, Array<{ relationship: TRelation; distance: number }>> = new Map();
    private readonly MAX_CACHE_SIZE = 500;

    /**
     * Register a symbol definition
     */
    registerSymbol(symbol: SymbolDefinition): void {
        const key = this.getSymbolKey(symbol.name, symbol.file);
        this.symbols.set(key, symbol);

        if (!this.fileSymbols.has(symbol.file)) {
            this.fileSymbols.set(symbol.file, new Set());
        }
        this.fileSymbols.get(symbol.file)!.add(symbol.name);
        this.clearCache();
    }

    /**
     * Add a relationship to the graph
     */
    protected addRelation(
        relation: TRelation,
        sourceKey: string,
        targetKey: string
    ): void {
        if (!this.forwardGraph.has(sourceKey)) {
            this.forwardGraph.set(sourceKey, new Set());
        }
        this.forwardGraph.get(sourceKey)!.add(relation);

        if (!this.reverseGraph.has(targetKey)) {
            this.reverseGraph.set(targetKey, new Set());
        }
        this.reverseGraph.get(targetKey)!.add(relation);

        this.clearCache();
    }

    /**
     * Generic depth-first search for transitive relationships
     */
    protected getTransitive(
        startKey: string,
        useReverse: boolean,
        keyFn: (rel: TRelation) => string,
        maxDepth: number = 10
    ): Array<{ relationship: TRelation; distance: number }> {
        const cacheKey = `${startKey}:${useReverse}:${maxDepth}`;

        // LRU logic: if hit, move to end (most recently used)
        if (this.memoCache.has(cacheKey)) {
            const cachedValue = this.memoCache.get(cacheKey)!;
            this.memoCache.delete(cacheKey);
            this.memoCache.set(cacheKey, cachedValue);
            return cachedValue;
        }

        const visited = new Set<string>();
        const results: Array<{ relationship: TRelation; distance: number }> = [];
        const graph = useReverse ? this.reverseGraph : this.forwardGraph;

        const dfs = (currentKey: string, depth: number) => {
            if (depth > maxDepth || visited.has(currentKey)) return;
            visited.add(currentKey);

            const relations = graph.get(currentKey);
            if (!relations) return;

            for (const rel of relations) {
                results.push({ relationship: rel, distance: depth });
                dfs(keyFn(rel), depth + 1);
            }
        };

        dfs(startKey, 0);

        // LRU logic: enforce max size by removing oldest (least recently used) entries
        if (this.memoCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.memoCache.keys().next().value;
            if (oldestKey !== undefined) this.memoCache.delete(oldestKey);
        }
        this.memoCache.set(cacheKey, results);

        return results;
    }

    /**
     * Clear all data for a specific file
     */
    clearFile(filePath: FilePath): void {
        const symbolsInFile = this.fileSymbols.get(filePath);
        if (symbolsInFile) {
            for (const symbolName of symbolsInFile) {
                this.symbols.delete(this.getSymbolKey(symbolName, filePath));
            }
            this.fileSymbols.delete(filePath);
        }

        // Use thorough filtering for both graphs
        this.filterIndex(filePath);
        this.clearCache();
    }

    /**
     * Thoroughly filter indices to remove relationships involving the given file
     */
    private filterIndex(filePath: string): void {
        const filePrefix = filePath + ':';

        // 1. Target forward index entries where source is in file
        for (const [sourceKey, relations] of this.forwardGraph.entries()) {
            if (sourceKey.startsWith(filePrefix)) {
                // For each relation we remove, we MUST also remove it from the reverse index
                for (const rel of relations) {
                    this.removeFromReverse(rel);
                }
                this.forwardGraph.delete(sourceKey);
            }
        }

        // 2. Target reverse index entries where target is in file
        for (const [targetKey, relations] of this.reverseGraph.entries()) {
            if (targetKey.startsWith(filePrefix)) {
                // For each relation we remove, we MUST also remove it from the forward index
                for (const rel of relations) {
                    this.removeFromForward(rel);
                }
                this.reverseGraph.delete(targetKey);
            }
        }
    }

    /**
     * Subclasses must implement these for the robust filterIndex to work without 'any'
     */
    protected abstract removeFromReverse(relation: TRelation): void;
    protected abstract removeFromForward(relation: TRelation): void;

    /**
     * Memory management - prunes empty sets from the graphs and clears cache
     */
    compactIfNeeded(): void {
        let pruned = 0;

        // 1. Prune forward graph
        for (const [key, relations] of this.forwardGraph.entries()) {
            if (relations.size === 0) {
                this.forwardGraph.delete(key);
                pruned++;
            }
        }

        // 2. Prune reverse graph
        for (const [key, relations] of this.reverseGraph.entries()) {
            if (relations.size === 0) {
                this.reverseGraph.delete(key);
                pruned++;
            }
        }

        // 3. Clear cache if we found anything to prune or it's getting large
        if (pruned > 0 || this.memoCache.size > this.MAX_CACHE_SIZE / 2) {
            this.clearCache();
        }
    }

    /**
     * Helper: Get symbol key
     */
    protected getSymbolKey(symbol: SymbolName, file: FilePath): FullSymbolIdentifier {
        return `${file}:${symbol}` as FullSymbolIdentifier;
    }

    /**
     * Clear cache
     */
    protected clearCache(): void {
        this.memoCache.clear();
    }

    /**
     * Get all symbol definitions in a file
     */
    getSymbolsInFile(file: FilePath): SymbolDefinition[] {
        const symbolNames = this.fileSymbols.get(file);
        if (!symbolNames) return [];

        const result: SymbolDefinition[] = [];
        for (const name of symbolNames) {
            const def = this.symbols.get(this.getSymbolKey(name, file));
            if (def) result.push(def);
        }
        return result;
    }

    /**
     * Helper: Find symbol definition
     */
    findSymbolDefinition(symbol: SymbolName, file?: FilePath): SymbolDefinition | undefined {
        if (file) return this.symbols.get(this.getSymbolKey(symbol, file));

        for (const def of this.symbols.values()) {
            if (def.name === symbol) return def;
        }
        return undefined;
    }

    /**
     * Clear all data
     */
    clear(): void {
        this.forwardGraph.clear();
        this.reverseGraph.clear();
        this.symbols.clear();
        this.fileSymbols.clear();
        this.clearCache();
    }
}
