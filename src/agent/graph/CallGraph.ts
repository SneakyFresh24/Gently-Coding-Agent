/**
 * Call Graph - Tracks "who calls who" relationships
 */

import {
  CallRelationship,
  SymbolDefinition,
  CallQueryResult,
  GraphStats,
  FilePath,
  SymbolName,
  FullSymbolIdentifier,
  toFilePath
} from './types';
import { BaseGraph } from './BaseGraph';

export class CallGraph extends BaseGraph<CallRelationship> {
  /**
   * Add a call relationship
   */
  addRelation(relation: CallRelationship): void {
    const calleeKey = relation.calleeFile
      ? this.getSymbolKey(relation.callee, relation.calleeFile)
      : relation.callee;

    super.addRelation(relation, relation.caller, calleeKey);
  }

  /**
   * Get all functions that a given function calls (direct callees)
   */
  getDirectCallees(caller: FullSymbolIdentifier): CallQueryResult[] {
    const relations = this.forwardGraph.get(caller);
    if (!relations) return [];

    return Array.from(relations).map(rel => ({
      relationship: rel,
      definition: this.findSymbolDefinition(rel.callee, rel.calleeFile),
      distance: 0
    }));
  }

  /**
   * Get all functions that call a given function (direct callers)
   */
  getDirectCallers(callee: SymbolName, calleeFile?: FilePath): CallQueryResult[] {
    const key = calleeFile ? this.getSymbolKey(callee, calleeFile) : callee;
    const relations = this.reverseGraph.get(key);

    if (!relations) {
      if (calleeFile) return this.getDirectCallers(callee);
      return [];
    }

    return Array.from(relations).map(rel => ({
      relationship: rel,
      definition: this.findSymbolDefinition(rel.callee, rel.calleeFile),
      distance: 0
    }));
  }

  /**
   * Get all transitive callers (direct + indirect callers)
   */
  getTransitiveCallers(callee: SymbolName, calleeFile?: FilePath, maxDepth: number = 10): CallQueryResult[] {
    const startKey = calleeFile ? this.getSymbolKey(callee, calleeFile) : callee;
    return super.getTransitive(
      startKey,
      true,
      rel => rel.caller,
      maxDepth
    );
  }

  /**
   * Get all transitive callees (direct + indirect callees)
   */
  getTransitiveCallees(caller: FullSymbolIdentifier, maxDepth: number = 10): CallQueryResult[] {
    return super.getTransitive(
      caller,
      false,
      rel => rel.calleeFile ? this.getSymbolKey(rel.callee, rel.calleeFile) : rel.callee,
      maxDepth
    );
  }

  /**
   * Find all files that would be affected by changing a function
   */
  getAffectedFiles(symbol: SymbolName, symbolFile?: FilePath): FilePath[] {
    const affectedFiles = new Set<FilePath>();
    const callers = this.getTransitiveCallers(symbol, symbolFile);

    for (const caller of callers) {
      // Use a helper to extract file safely from FullSymbolIdentifier
      const file = this.getFileFromSymbolKey(caller.relationship.caller);
      if (file) affectedFiles.add(file);
    }

    return Array.from(affectedFiles);
  }

  /**
   * Helper: Safely extract file path from a full symbol key
   * A FullSymbolIdentifier is formatted as "filePath:symbolName"
   */
  private getFileFromSymbolKey(key: FullSymbolIdentifier): FilePath | null {
    const identifier = String(key);
    const separatorIndex = identifier.lastIndexOf(':');
    if (separatorIndex <= 0) return null;
    return toFilePath(identifier.slice(0, separatorIndex));
  }

  /**
   * Get statistics about the call graph
   */
  getStats(): GraphStats {
    let totalCalls = 0;
    for (const relations of this.forwardGraph.values()) {
      totalCalls += relations.size;
    }

    const mostCalled = Array.from(this.reverseGraph.entries())
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10)
      .map(([symbol, rels]) => ({ symbol, count: rels.size }));

    const mostCalling = Array.from(this.forwardGraph.entries())
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10)
      .map(([symbol, rels]) => ({ symbol, count: rels.size }));

    return {
      totalCalls,
      totalImports: 0,
      totalSymbols: this.symbols.size,
      filesIndexed: this.fileSymbols.size,
      mostCalled,
      mostCalling
    };
  }

  // No longer needed, moved to BaseGraph

  // Implementation of abstract methods for cleanup
  protected removeFromReverse(rel: CallRelationship): void {
    const calleeKey = rel.calleeFile ? this.getSymbolKey(rel.callee, rel.calleeFile) : rel.callee;
    const reverseRels = this.reverseGraph.get(calleeKey);
    if (reverseRels) {
      reverseRels.delete(rel);
      if (reverseRels.size === 0) this.reverseGraph.delete(calleeKey);
    }
  }

  protected removeFromForward(rel: CallRelationship): void {
    const forwardRels = this.forwardGraph.get(rel.caller);
    if (forwardRels) {
      forwardRels.delete(rel);
      if (forwardRels.size === 0) this.forwardGraph.delete(rel.caller);
    }
  }
}

