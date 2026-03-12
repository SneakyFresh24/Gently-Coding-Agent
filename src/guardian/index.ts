/**
 * Guardian Module - Proactive Code Health Engine
 * 
 * Main entry point for the Guardian system
 */

export { GuardianService } from './GuardianService';
export { AnalyzerManager } from './AnalyzerManager';
export { BackgroundTaskManager } from './BackgroundTaskManager';
export { GuardianIntegration } from './GuardianIntegration';
export { QuickFixService } from './QuickFixService';
export { GuardianViewProvider } from './views/GuardianViewProvider';

// Types
export {
  GuardianIssue,
  GuardianIssueType,
  GuardianSeverity,
  GuardianSuggestion,
  SuggestionType,
  SuggestionAction,
  EffortLevel,
  GuardianIssueMetadata,
  GuardianSource,
  GuardianConfig,
  GuardianStats,
  GuardianAnalysisContext,
  GuardianAnalysisResult,
  CodeDuplicationResult,
  CodeBlock,
  DeadCodeResult,
  UnusedSymbol,
  UnusedImport,
  ArchitecturalDriftResult,
  ArchitecturalViolation,
  SecurityPatternResult,
  SecurityVulnerability
} from './types';

// Analyzers
export { IAnalyzer, BaseAnalyzer } from './analyzers/BaseAnalyzer';
export { CodeDuplicationAnalyzer } from './analyzers/CodeDuplicationAnalyzer';
export { DeadCodeAnalyzer } from './analyzers/DeadCodeAnalyzer';
export { ArchitecturalDriftAnalyzer } from './analyzers/ArchitecturalDriftAnalyzer';
export { SecurityPatternAnalyzer } from './analyzers/SecurityPatternAnalyzer';
export { PerformanceAnalyzer } from './analyzers/PerformanceAnalyzer';