/**
 * Memory System Types for Gently
 * 
 * Inspired by Augment Code's Memories feature
 */

// Branded Types for better type safety
export type MemoryId = string & { readonly __brand: 'MemoryId' };
export type PatternId = string & { readonly __brand: 'PatternId' };
export type CorrectionId = string & { readonly __brand: 'CorrectionId' };

export type MemoryCategory =
  | 'preference'    // User preferences (coding style, naming conventions)
  | 'codebase'      // Codebase architecture and patterns
  | 'workflow'      // Development workflow and processes
  | 'tech-stack'    // Technologies, frameworks, libraries used
  | 'general';      // General information

export type MemorySource =
  | 'manual'        // User manually added
  | 'automatic'     // Agent automatically learned
  | 'agent';        // Agent suggested and user confirmed

export type MemoryStatus =
  | 'active'        // Currently active and used
  | 'deprecated'    // Marked as outdated
  | 'archived';     // Soft deleted, not used

export interface MemoryScope {
  language?: string[];          // Programming languages (e.g., ['typescript', 'javascript'])
  fileExtension?: string[];     // File extensions (e.g., ['.ts', '.tsx'])
  pathPattern?: string[];       // Path patterns (e.g., ['src/components/*', 'tests/*'])
  excludePattern?: string[];    // Exclude patterns (e.g., ['node_modules/*'])
  fileType?: string[];          // File types (e.g., ['component', 'test', 'config'])
}

export interface Memory {
  id: MemoryId;
  content: string;
  category: MemoryCategory;
  embedding?: number[];
  metadata: MemoryMetadata;
  status: MemoryStatus;
  confidence: number;           // 0-1, decreases with conflicts
  lastUsed?: number;            // Timestamp for cache/deprecation
  usageCount?: number;          // How many times this was retrieved
  deprecatedAt?: number;        // When was it deprecated
  deprecationReason?: string;   // Why was it deprecated
  supersededBy?: string;        // ID of the memory that replaced this one
  scope?: MemoryScope;          // Optional scope restrictions
}

export interface MemoryMetadata {
  createdAt: number;
  lastUsed: number;
  useCount: number;
  source: MemorySource;
  tags: string[];
  relevanceScore: number;
}

export interface MemorySearchResult {
  memory: Memory;
  score: number;
  reason: string;
}

export interface MemoryStats {
  totalMemories: number;
  byCategory: Record<MemoryCategory, number>;
  bySource: Record<MemorySource, number>;
  byStatus: Record<MemoryStatus, number>;
  mostUsed: Memory[];
  recentlyAdded: Memory[];
  lowConfidence: Memory[];  // Memories with confidence < 0.5
}

export interface MemoryConflict {
  existingMemory: Memory;
  newContent: string;
  conflictReason: string;
  similarity: number;  // 0-1, how similar are they
}

export interface MemoryContext {
  language?: string;            // Current language (e.g., 'typescript')
  fileExtension?: string;       // Current file extension (e.g., '.ts')
  filePath?: string;            // Current file path (e.g., 'src/components/Button.tsx')
  fileType?: string;            // Current file type (e.g., 'component')
}

export interface ScopeMatchResult {
  matches: boolean;
  score: number;                // 0-1, how well does it match
  reason: string;               // Why it matches/doesn't match
}

