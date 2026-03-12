/**
 * Type definitions for Call Graph and Relationship Graph
 */

/**
 * Branded Types for enhanced type safety
 */
export type FilePath = string & { readonly __brand: 'FilePath' };
export type SymbolName = string & { readonly __brand: 'SymbolName' };

/** Full identifier in format "path/to/file.ts:symbolName" */
export type FullSymbolIdentifier = string & { readonly __brand: 'FullSymbolIdentifier' };

/**
 * Branded Type Helpers - safely convert strings to branded types at boundaries
 */
export function toFilePath(s: string): FilePath { return s as FilePath; }
export function toSymbolName(s: string): SymbolName { return s as SymbolName; }
export function toFullSymbolIdentifier(s: string): FullSymbolIdentifier { return s as FullSymbolIdentifier; }

/**
 * Type of call relationship
 */
export type CallType =
  | 'direct'      // Direct function call: myFunction()
  | 'method'      // Method call: obj.method()
  | 'constructor' // Constructor call: new MyClass()
  | 'property';   // Property access that might be a function

/**
 * Represents a single call relationship
 */
export interface CallRelationship {
  /** Full caller identifier: "src/login.ts:handleLogin" */
  caller: FullSymbolIdentifier;

  /** Callee function name: "authenticateUser" */
  callee: SymbolName;

  /** Resolved file path of callee (if known): "src/auth.ts" */
  calleeFile?: FilePath;

  /** Line number where the call occurs */
  line: number;

  /** Column number where the call occurs */
  column?: number;

  /** Type of call */
  type: CallType;

  /** Additional context (e.g., "this.method", "module.function") */
  context?: string;
}

/**
 * Represents an import relationship
 */
export interface ImportRelationship {
  /** File that imports: "src/login.ts" */
  importer: FilePath;

  /** Symbol being imported: "AuthService" */
  symbol: SymbolName;

  /** Source module: "./auth" or "vscode" */
  source: string;

  /** Resolved file path (if local): "src/auth.ts" */
  resolvedPath?: FilePath;

  /** Import type */
  type: 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic' | 'require';

  /** Line number of import */
  line: number;
}

/**
 * Symbol definition (function, class, etc.)
 */
export interface SymbolDefinition {
  /** Symbol name: "authenticateUser" */
  name: SymbolName;

  /** File where defined: "src/auth.ts" */
  file: FilePath;

  /** Line number */
  line: number;

  /** Symbol kind */
  kind: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type';

  /** Is exported? */
  exported: boolean;

  /** Signature (if available) */
  signature?: string;
}

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Total number of call relationships */
  totalCalls: number;

  /** Total number of import relationships */
  totalImports: number;

  /** Total number of symbols */
  totalSymbols: number;

  /** Number of files indexed */
  filesIndexed: number;

  /** Most called functions (top 10) */
  mostCalled: Array<{ symbol: string; count: number }>;

  /** Most calling functions (top 10) */
  mostCalling: Array<{ symbol: string; count: number }>;
}

/**
 * Query result for callers/callees
 */
export interface CallQueryResult {
  /** The relationship */
  relationship: CallRelationship;

  /** Symbol definition (if found) */
  definition?: SymbolDefinition;

  /** Distance from query (0 = direct, 1 = one hop, etc.) */
  distance: number;
}

/**
 * Query result for imports
 */
export interface ImportQueryResult {
  /** The import relationship */
  relationship: ImportRelationship;

  /** Symbol definition (if found) */
  definition?: SymbolDefinition;
}

