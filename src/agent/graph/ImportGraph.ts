/**
 * Import Graph - Tracks "who imports who" relationships
 */

import * as path from 'path';
import {
  ImportRelationship,
  ImportQueryResult,
  SymbolDefinition,
  FilePath,
  SymbolName,
  toFilePath
} from './types';
import { BaseGraph } from './BaseGraph';

export class ImportGraph extends BaseGraph<ImportRelationship> {
  /**
   * Add an import relationship
   */
  addImport(relation: ImportRelationship): void {
    const symbolKey = relation.resolvedPath
      ? this.getSymbolKey(relation.symbol, relation.resolvedPath)
      : relation.symbol;

    super.addRelation(relation, relation.importer, symbolKey);

    // Also index by file path directly to support file-level transitive queries
    if (relation.resolvedPath) {
      super.addRelation(relation, relation.importer, relation.resolvedPath);
    }
  }

  /**
   * Get all symbols imported by a file
   */
  getImports(filePath: FilePath): ImportQueryResult[] {
    const relations = this.forwardGraph.get(filePath);
    if (!relations) return [];

    return Array.from(relations).map(rel => ({
      relationship: rel,
      definition: this.findSymbolDefinition(rel.symbol, rel.resolvedPath)
    }));
  }

  /**
   * Get all files that import a specific symbol
   */
  getImporters(symbol: SymbolName, symbolFile?: FilePath): ImportQueryResult[] {
    const key = symbolFile ? this.getSymbolKey(symbol, symbolFile) : symbol;
    const relations = this.reverseGraph.get(key);

    if (!relations) {
      if (symbolFile) return this.getImporters(symbol);
      return [];
    }

    return Array.from(relations).map(rel => ({
      relationship: rel,
      definition: this.findSymbolDefinition(rel.symbol, rel.resolvedPath)
    }));
  }

  /**
   * Get all transitive importers (files that import, and files that import those, etc.)
   */
  getTransitiveImporters(symbol: SymbolName, symbolFile?: FilePath, maxDepth: number = 10): ImportQueryResult[] {
    const startKey = symbolFile ? this.getSymbolKey(symbol, symbolFile) : symbol;

    return super.getTransitive(
      startKey,
      true,
      rel => {
        // In reverse search, the target of the previous step becomes the importer file path
        return rel.importer;
      },
      maxDepth
    );
  }

  /**
   * Get all files that depend on a given file (directly or indirectly)
   */
  getDependentFiles(filePath: FilePath): FilePath[] {
    const dependents = new Set<FilePath>();

    // Search transitively starting from the file path itself
    // Since we now index by file path in addImport, this will find all files that import this file
    const transitiveImporters = super.getTransitive(
      filePath,
      true,
      rel => rel.importer,
      10
    );

    for (const imp of transitiveImporters) {
      dependents.add(imp.relationship.importer);
    }

    return Array.from(dependents);
  }

  /**
   * Get all files that a given file depends on (directly or indirectly)
   */
  getDependencies(filePath: FilePath, maxDepth: number = 10): FilePath[] {
    const dependencies = new Set<FilePath>();
    const transitiveImports = super.getTransitive(
      filePath,
      false,
      rel => {
        // Next key in forward search is the resolved file path
        // Use a safe fallback if resolvedPath is missing
        return rel.resolvedPath || rel.source;
      },
      maxDepth
    );

    for (const imp of transitiveImports) {
      const rel = imp.relationship;
      if (rel.resolvedPath) dependencies.add(rel.resolvedPath);
    }

    return Array.from(dependencies);
  }

  /**
   * Resolve import path to absolute file path
   */
  resolveImportPath(importer: FilePath, importPath: string, workspaceRoot: string): FilePath | null {
    if (!importPath.startsWith('.')) return null;

    const importerDir = path.dirname(importer);
    let resolved = path.resolve(importerDir, importPath);

    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts'];

    for (const ext of extensions) {
      const fullPath = resolved + ext;
      return toFilePath(fullPath);
    }

    for (const ext of extensions) {
      const indexPath = path.join(resolved, `index${ext}`);
      return toFilePath(indexPath);
    }

    return toFilePath(resolved);
  }

  /**
   * Get total number of imports
   */
  getTotalImports(): number {
    let total = 0;
    for (const set of this.forwardGraph.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Helper: Get exported symbols from a file
   */
  private getExportedSymbols(filePath: FilePath): SymbolName[] {
    const exported: SymbolName[] = [];
    for (const def of this.symbols.values()) {
      if (def.file === filePath && def.exported) exported.push(def.name);
    }
    return exported;
  }

  // Implementation of abstract methods for cleanup
  protected removeFromReverse(rel: ImportRelationship): void {
    const keys = [
      rel.resolvedPath ? this.getSymbolKey(rel.symbol, rel.resolvedPath) : rel.symbol,
      rel.resolvedPath // Also clean up file-level index
    ];

    for (const key of keys) {
      if (!key) continue;
      const reverseRels = this.reverseGraph.get(key);
      if (reverseRels) {
        reverseRels.delete(rel);
        if (reverseRels.size === 0) this.reverseGraph.delete(key);
      }
    }
  }

  protected removeFromForward(rel: ImportRelationship): void {
    const forwardRels = this.forwardGraph.get(rel.importer);
    if (forwardRels) {
      forwardRels.delete(rel);
      if (forwardRels.size === 0) this.forwardGraph.delete(rel.importer);
    }
  }
}
