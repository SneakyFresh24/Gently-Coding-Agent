/**
 * Relationship Graph - Unified API for Call Graph + Import Graph
 * 
 * This is the main entry point for querying code relationships.
 * Combines semantic search with structural analysis.
 */

import { CallGraph } from './CallGraph';
import { ImportGraph } from './ImportGraph';
import { TypeScriptCallExtractor } from './TypeScriptCallExtractor';
import { TypeScriptImportExtractor } from './TypeScriptImportExtractor';
import {
  CallRelationship,
  SymbolDefinition,
  CallQueryResult,
  ImportQueryResult,
  GraphStats,
  FilePath,
  SymbolName,
  FullSymbolIdentifier
} from './types';

export interface RelationshipGraphOptions {
  workspaceRoot: string;
}

export class RelationshipGraph {
  private callGraph: CallGraph;
  private importGraph: ImportGraph;
  private callExtractor: TypeScriptCallExtractor;
  private importExtractor: TypeScriptImportExtractor;
  private workspaceRoot: string;

  constructor(options: RelationshipGraphOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.callGraph = new CallGraph();
    this.importGraph = new ImportGraph();
    this.callExtractor = new TypeScriptCallExtractor();
    this.importExtractor = new TypeScriptImportExtractor();
  }

  /**
   * Index a file - extract call and import relationships
   */
  async indexFile(filePath: FilePath, content: string, language: string): Promise<void> {
    if (!this.isTypeScriptFile(language)) return;

    try {
      // 1. Extract and Index Calls
      const { calls, symbols } = this.callExtractor.extract(filePath, content);
      for (const s of symbols) {
        this.callGraph.registerSymbol(s);
        this.importGraph.registerSymbol(s);
      }
      for (const c of calls) {
        this.callGraph.addRelation(c);
      }

      // 2. Extract and Index Imports
      const imports = this.importExtractor.extract(filePath, content);
      for (const imp of imports) {
        const resolvedPath = this.importGraph.resolveImportPath(
          imp.importer,
          imp.source,
          this.workspaceRoot
        );

        this.importGraph.addImport({
          ...imp,
          resolvedPath: resolvedPath || undefined
        });
      }
    } catch (error) {
      console.error(`[RelationshipGraph] Error indexing ${filePath}:`, error);
    }
  }

  /**
   * Get all functions that call a given function (direct callers)
   */
  getDirectCallers(symbol: SymbolName, symbolFile?: FilePath): CallQueryResult[] {
    return this.callGraph.getDirectCallers(symbol, symbolFile);
  }

  /**
   * Get all functions that a given function calls (direct callees)
   */
  getDirectCallees(caller: FullSymbolIdentifier): CallQueryResult[] {
    return this.callGraph.getDirectCallees(caller);
  }

  /**
   * Get all transitive callers (direct + indirect callers)
   */
  getTransitiveCallers(symbol: SymbolName, symbolFile?: FilePath, maxDepth?: number): CallQueryResult[] {
    return this.callGraph.getTransitiveCallers(symbol, symbolFile, maxDepth);
  }

  /**
   * Get all transitive callees (direct + indirect callees)
   */
  getTransitiveCallees(caller: FullSymbolIdentifier, maxDepth?: number): CallQueryResult[] {
    return this.callGraph.getTransitiveCallees(caller, maxDepth);
  }

  /**
   * Get all files that import a specific symbol
   */
  getFilesImportingSymbol(symbol: SymbolName, symbolFile?: FilePath): ImportQueryResult[] {
    return this.importGraph.getImporters(symbol, symbolFile);
  }

  /**
   * Get all symbols imported by a file
   */
  getImportedSymbols(filePath: FilePath): ImportQueryResult[] {
    return this.importGraph.getImports(filePath);
  }

  /**
   * Get all files that depend on a given file (import it directly or indirectly)
   */
  getDependentFiles(filePath: FilePath): FilePath[] {
    return this.importGraph.getDependentFiles(filePath);
  }

  /**
   * Get all files that a given file depends on (imports directly or indirectly)
   */
  getDependencies(filePath: FilePath, maxDepth?: number): FilePath[] {
    return this.importGraph.getDependencies(filePath, maxDepth);
  }

  /**
   * Remove all data for a specific file (for incremental updates)
   */
  removeFile(filePath: FilePath): void {
    this.callGraph.clearFile(filePath);
    this.importGraph.clearFile(filePath);
  }

  /**
   * Get all symbols defined in a specific file
   */
  getSymbolsInFile(filePath: FilePath): SymbolDefinition[] {
    return this.callGraph.getSymbolsInFile(filePath);
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.callGraph.clear();
    this.importGraph.clear();
  }

  /**
   * Get all files that would be affected by changing a function
   * Combines transitive callers (structural) and transitive importers (dependency).
   * 
   * Precision Logic:
   * 1. Transitive Callers: Always included. If F1 calls F2, F1 is affected by changes in F2.
   * 2. Transitive Importers: Only included if the symbol is EXPORTED. 
   *    If a symbol is private to its file, external files cannot be affected by its changes
   *    beyond what is already captured in the call graph (internal calls).
   */
  getAffectedFiles(symbol: SymbolName, symbolFile?: FilePath): FilePath[] {
    const affectedFiles = new Set<FilePath>();

    // 1. Get files containing functions that call this function (Transitive Callers)
    // These are always affected, whether the function is exported or not
    const callers = this.callGraph.getAffectedFiles(symbol, symbolFile);
    for (const file of callers) {
      affectedFiles.add(file);
    }

    // 2. Get files that import the file where the symbol is defined (Transitive Importers)
    // ONLY if the symbol is exported can it be called from other files via imports.
    if (symbolFile) {
      const symbolsInFile = this.callGraph.getSymbolsInFile(symbolFile);
      const symbolDef = symbolsInFile.find(s => s.name === symbol);

      // If symbol is exported (or we don't have its definition to be safe), check dependent files
      const isActuallyExported = symbolDef ? symbolDef.exported : true;

      if (isActuallyExported) {
        const dependents = this.importGraph.getDependentFiles(symbolFile);
        for (const file of dependents) {
          affectedFiles.add(file);
        }
      }

      // Also add the file itself (where the change is happening)
      affectedFiles.add(symbolFile);
    }

    return Array.from(affectedFiles);
  }

  /**
   * Get statistics about the relationship graph
   */
  getStats(): GraphStats {
    const callStats = this.callGraph.getStats();
    return {
      ...callStats,
      totalImports: this.importGraph.getTotalImports()
    };
  }

  /**
   * Helper: Check if file is TypeScript/JavaScript
   */
  private isTypeScriptFile(language: string): boolean {
    return ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(language);
  }
}
