/**
 * Types for the Gently Guardian - Proactive Code Health Engine
 */

export interface GuardianIssue {
  id: string;
  type: GuardianIssueType;
  severity: GuardianSeverity;
  title: string;
  description: string;
  filePath: string;
  lineNumbers?: number[];
  suggestions: GuardianSuggestion[];
  metadata: GuardianIssueMetadata;
  createdAt: number;
  dismissedAt?: number;
}

export enum GuardianIssueType {
  CODE_DUPLICATION = 'code_duplication',
  DEAD_CODE = 'dead_code',
  ARCHITECTURAL_DRIFT = 'architectural_drift',
  SECURITY_PATTERN = 'security_pattern',
  PERFORMANCE_ISSUE = 'performance_issue',
  MAINTAINABILITY = 'maintainability',
  TEST_COVERAGE = 'test_coverage'
}

export enum GuardianSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export function getSeverityWeight(severity: GuardianSeverity | string): number {
  switch (severity) {
    case GuardianSeverity.CRITICAL: return 4;
    case GuardianSeverity.HIGH: return 3;
    case GuardianSeverity.MEDIUM: return 2;
    case GuardianSeverity.LOW: return 1;
    default: return 0;
  }
}

export interface GuardianSuggestion {
  id: string;
  type: SuggestionType;
  title: string;
  description: string;
  action: SuggestionAction;
  confidence: number; // 0-1
  estimatedEffort: EffortLevel;
}

export enum SuggestionType {
  REFACTOR = 'refactor',
  EXTRACT_FUNCTION = 'extract_function',
  REMOVE_UNUSED = 'remove_unused',
  ADD_TEST = 'add_test',
  UPDATE_IMPORT = 'update_import',
  SECURITY_FIX = 'security_fix',
  PERFORMANCE_OPTIMIZATION = 'performance_optimization'
}

export enum SuggestionAction {
  SHOW_ME = 'show_me',
  FIX_IT = 'fix_it',
  DISMISS = 'dismiss'
}

export enum EffortLevel {
  TRIVIAL = 'trivial', // < 5 minutes
  LOW = 'low', // 5-15 minutes
  MEDIUM = 'medium', // 15-30 minutes
  HIGH = 'high', // 30-60 minutes
  SIGNIFICANT = 'significant' // > 1 hour
}

export interface GuardianIssueMetadata {
  source: GuardianSource;
  context?: string;
  relatedFiles?: string[];
  patternId?: string;
  memoryId?: string;
  validationErrors?: string[];
}

export enum GuardianSource {
  RELATIONSHIP_GRAPH = 'relationship_graph',
  MEMORY_SYSTEM = 'memory_system',
  VALIDATION_PIPELINE = 'validation_pipeline',
  HYBRID_SEARCH = 'hybrid_search',
  PATTERN_RECOGNITION = 'pattern_recognition'
}

export interface GuardianConfig {
  enabled: boolean;
  autoAnalysis: boolean;
  analysisInterval: number; // milliseconds
  maxIssuesPerFile: number;
  severityThreshold: GuardianSeverity;
  enabledIssueTypes: GuardianIssueType[];
  excludePatterns: string[];
  includePatterns: string[];
}

export interface GuardianStats {
  totalIssues: number;
  issuesByType: Record<GuardianIssueType, number>;
  issuesBySeverity: Record<GuardianSeverity, number>;
  dismissedIssues: number;
  fixedIssues: number;
  lastAnalysisTime: number;
  analysisDuration: number;
}

export interface CodeDuplicationResult {
  duplicatedBlocks: CodeBlock[];
  similarity: number;
  files: string[];
}

export interface CodeBlock {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  hash: string;
}

export interface DeadCodeResult {
  unusedSymbols: UnusedSymbol[];
  unusedImports: UnusedImport[];
}

export interface UnusedSymbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'interface';
  filePath: string;
  line: number;
  references: number;
}

export interface UnusedImport {
  source: string;
  filePath: string;
  line: number;
  importedSymbols: string[];
}

export interface ArchitecturalDriftResult {
  violations: ArchitecturalViolation[];
}

export interface ArchitecturalViolation {
  type: string;
  description: string;
  filePath: string;
  line: number;
  memoryId?: string;
  suggestion?: string;
}

export interface SecurityPatternResult {
  vulnerabilities: SecurityVulnerability[];
}

export interface SecurityVulnerability {
  type: string;
  severity: GuardianSeverity;
  description: string;
  filePath: string;
  line: number;
  pattern: string;
  recommendation: string;
}

export interface GuardianAnalysisContext {
  workspaceRoot: string;
  changedFiles: string[];
  fullAnalysis: boolean;
  timestamp: number;
  getFileContent?: (filePath: string) => string;
}

export interface GuardianAnalysisResult {
  issues: GuardianIssue[];
  stats: GuardianStats;
  context: GuardianAnalysisContext;
  duration: number;
}