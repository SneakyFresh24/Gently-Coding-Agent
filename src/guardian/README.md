# Gently Guardian - Proactive Code Health Engine

## Overview

Gently Guardian is a proactive code health engine that continuously analyzes your codebase for potential issues, security vulnerabilities, performance problems, and architectural drift. It provides intelligent suggestions and automatic fixes to improve code quality and maintainability.

## Features

- 🔍 **Multi-Analyzer System**: Code duplication, dead code, architectural drift, security, and performance analysis
- 🚀 **Background Analysis**: Intelligent task scheduling with resource-aware execution
- 🛠️ **Quick Fix Integration**: Automatic code fixes powered by Agent Mode
- 📊 **Rich UI**: Interactive webview with issue details and real-time statistics

## Quick Start

```typescript
import { GuardianIntegration } from './guardian';
import { RelationshipGraph } from './agent/graph/RelationshipGraph';
import { MemoryManager } from './agent/memory/MemoryManager';
import { ValidationManager } from './agent/validation/ValidationManager';
import { HybridRetriever } from './agent/retrieval/HybridRetriever';
import { CodebaseIndexer } from './agent/CodebaseIndexer';

// Initialize Guardian
const guardian = new GuardianIntegration(
  workspaceRoot,
  relationshipGraph,
  memoryManager,
  validationManager,
  hybridRetriever,
  codebaseIndexer,
  extensionUri
);

// Start Guardian
await guardian.initialize();
await guardian.start();
```

## Architecture

```
Guardian Integration
├── Guardian Service
│   ├── Analyzer Manager
│   ├── Issue Manager
│   └── Config Manager
├── Background Task Manager
│   ├── Task Scheduler
│   ├── Resource Monitor
│   └── Performance Monitor
├── Analyzers
│   ├── Code Duplication Analyzer
│   ├── Dead Code Analyzer
│   ├── Architectural Drift Analyzer
│   ├── Security Pattern Analyzer
│   └── Performance Analyzer
├── Quick Fix Service
└── UI Components
    ├── Guardian View Provider
    ├── Guardian CSS
    └── Guardian JavaScript
```

## Usage Examples

### Basic Analysis

```typescript
// Get all issues
const issues = guardian.getGuardianService()?.getIssues();

// Get issues for a specific file
const fileIssues = guardian.getGuardianService()?.getIssuesForFile(filePath);

// Analyze workspace
await guardian.analyzeWorkspace();

// Analyze active file
await guardian.analyzeActiveFile();
```

### Quick Fixes

```typescript
// Apply quick fix
const quickFixService = guardian.getQuickFixService();
if (quickFixService && quickFixService.canFix(suggestion)) {
  const result = await quickFixService.applyQuickFix(issue, suggestion);
  if (result.success) {
    console.log('Fix applied successfully');
  }
}

// Apply batch fixes
const fixes = issues.flatMap(issue => 
  issue.suggestions
    .filter(suggestion => quickFixService!.canFix(suggestion))
    .map(suggestion => ({ issue, suggestion }))
);

const results = await quickFixService.applyBatchFixes(fixes);
```

### Custom Analyzers

```typescript
import { BaseAnalyzer } from './analyzers/BaseAnalyzer';
import { GuardianAnalysisContext, GuardianIssue } from './types';

class CustomAnalyzer extends BaseAnalyzer {
  constructor() {
    super(
      'custom-analyzer',
      'Custom Analyzer',
      'Detects custom issues'
    );
  }

  async analyze(context: GuardianAnalysisContext): Promise<GuardianIssue[]> {
    // Implement custom analysis logic
    return [];
  }
}

// Register custom analyzer
const analyzerManager = guardian.getGuardianService()?.getAnalyzerManager();
analyzerManager?.registerAnalyzer(new CustomAnalyzer());
```

## Configuration

```typescript
const config = {
  enabled: true,
  autoAnalysis: true,
  analysisInterval: 5 * 60 * 1000, // 5 minutes
  maxIssuesPerFile: 10,
  severityThreshold: 'medium',
  enabledIssueTypes: [
    'code_duplication',
    'dead_code',
    'architectural_drift',
    'security_pattern',
    'performance_issue'
  ],
  excludePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**'
  ]
};

guardian.updateConfig(config);
```

## Testing

Run the Guardian tests:

```bash
# Run all tests
npm run test:guardian

# Run specific test file
npx ts-node src/guardian/__tests__/runTests.ts
```

## API Reference

### GuardianIntegration

Main integration class for Guardian.

```typescript
class GuardianIntegration extends EventEmitter {
  constructor(
    workspaceRoot: string,
    relationshipGraph: RelationshipGraph,
    memoryManager: MemoryManager,
    validationManager: ValidationManager,
    hybridRetriever: HybridRetriever,
    codebaseIndexer: CodebaseIndexer,
    extensionUri: vscode.Uri,
    config?: Partial<GuardianIntegrationConfig>
  );
  
  async initialize(): Promise<void>;
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async analyzeWorkspace(): Promise<void>;
  async analyzeActiveFile(): Promise<void>;
  async showIssues(): Promise<void>;
  dismissAllIssues(): void>;
  openSettings(): void;
  dispose(): void;
}
```

### GuardianService

Core service for managing Guardian operations.

```typescript
class GuardianService extends EventEmitter {
  constructor(
    workspaceRoot: string,
    relationshipGraph: RelationshipGraph,
    memoryManager: MemoryManager,
    validationManager: ValidationManager,
    hybridRetriever: HybridRetriever,
    codebaseIndexer: CodebaseIndexer,
    config?: Partial<GuardianConfig>
  );
  
  async initialize(): Promise<void>;
  async performAnalysis(changedFiles: string[], fullAnalysis: boolean): Promise<GuardianAnalysisResult>;
  getIssues(): GuardianIssue[];
  getIssuesForFile(filePath: string): GuardianIssue[];
  dismissIssue(issueId: string): boolean;
  getStats(): GuardianStats;
  updateConfig(config: Partial<GuardianConfig>): void;
  getConfig(): GuardianConfig;
  dispose(): void;
}
```

### AnalyzerManager

Manages the individual analyzers.

```typescript
class AnalyzerManager extends EventEmitter {
  constructor(
    relationshipGraph: RelationshipGraph,
    memoryManager: MemoryManager
  );
  
  registerAnalyzer(analyzer: IAnalyzer): void;
  unregisterAnalyzer(analyzerId: string): boolean;
  getAnalyzer(analyzerId: string): IAnalyzer | undefined;
  getAllAnalyzers(): IAnalyzer[];
  getEnabledAnalyzers(): IAnalyzer[];
  enableAnalyzer(analyzerId: string): boolean;
  disableAnalyzer(analyzerId: string): boolean;
  async runAnalysis(context: GuardianAnalysisContext, config?: GuardianConfig): Promise<GuardianIssue[]>;
  updateConfig(config: GuardianConfig): void;
  dispose(): void;
}
```

### BackgroundTaskManager

Manages background analysis tasks.

```typescript
class BackgroundTaskManager extends EventEmitter {
  constructor(guardianService: GuardianService, config?: Partial<BackgroundTaskConfig>);
  
  start(): void;
  stop(): void;
  scheduleTask(context: GuardianAnalysisContext, priority?: TaskPriority, taskType?: TaskType): string;
  scheduleIncrementalAnalysis(changedFiles: string[]): string;
  scheduleFullAnalysis(): string;
  scheduleBatchAnalysis(files: string[]): string;
  cancelTask(taskId: string): boolean;
  getTaskStatus(taskId: string): TaskStatus | null;
  getAllTasks(): Task[];
  updateConfig(config: Partial<BackgroundTaskConfig>): void;
  dispose(): void;
}
```

### QuickFixService

Provides automatic fix capabilities.

```typescript
class QuickFixService extends EventEmitter {
  constructor(agentMode?: AgentMode, config?: Partial<QuickFixConfig>);
  
  setAgentMode(agentMode: AgentMode): void;
  canFix(suggestion: GuardianSuggestion): boolean;
  async applyQuickFix(issue: GuardianIssue, suggestion: GuardianSuggestion): Promise<QuickFixResult>;
  async applyBatchFixes(fixes: Array<{ issue: GuardianIssue; suggestion: GuardianSuggestion }>): Promise<QuickFixResult[]>;
  getActiveFixes(): string[];
  async cancelFix(fixId: string): Promise<boolean>;
  updateConfig(config: Partial<QuickFixConfig>): void;
  getConfig(): QuickFixConfig;
  dispose(): void;
}
```

## Contributing

To contribute to Guardian:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

### Adding New Analyzers

1. Create a new analyzer class extending `BaseAnalyzer`
2. Implement the `analyze` method
3. Register the analyzer in `AnalyzerManager`
4. Add tests for the new analyzer

### Adding New Fix Types

1. Extend the `SuggestionType` enum
2. Add fix logic to `QuickFixService`
3. Update Agent Mode integration
4. Add tests for the new fix type

## License

Guardian is part of Gently and follows the same license terms.