/**
 * Guardian Integration
 * 
 * Integrates the Guardian system into the main Gently extension
 */

import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { GuardianService, BackgroundTaskManager, QuickFixService } from './index';
import { GuardianViewProvider } from './views/GuardianViewProvider';
import { RelationshipGraph } from '../agent/graph/RelationshipGraph';
import { MemoryManager } from '../agent/memory/MemoryManager';
import { ValidationManager } from '../agent/validation/ValidationManager';
import { HybridRetriever } from '../agent/retrieval/HybridRetriever';
import { CodebaseIndexer } from '../agent/CodebaseIndexer';
import { AgentManager } from '../agent/agentManager/AgentManager';
import { GuardianConfig, GuardianIssue } from './types';
import * as path from 'path';

export interface GuardianIntegrationConfig {
  enabled: boolean;
  autoStart: boolean;
  showNotifications: boolean;
  statusBarItem: boolean;
  outputChannel: boolean;
}

const DEFAULT_INTEGRATION_CONFIG: GuardianIntegrationConfig = {
  enabled: true,
  autoStart: true,
  showNotifications: true,
  statusBarItem: true,
  outputChannel: true
};

export class GuardianIntegration extends EventEmitter {
  private config: GuardianIntegrationConfig;
  private guardianService?: GuardianService;
  private backgroundTaskManager?: BackgroundTaskManager;
  private quickFixService?: QuickFixService;
  private guardianViewProvider?: GuardianViewProvider;
  private statusBarItem?: vscode.StatusBarItem;
  private outputChannel?: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];
  private workspaceRoot: string;
  private extensionUri: vscode.Uri;

  constructor(
    workspaceRoot: string,
    private relationshipGraph: RelationshipGraph,
    private memoryManager: MemoryManager,
    private validationManager: ValidationManager,
    private hybridRetriever: HybridRetriever,
    private codebaseIndexer: CodebaseIndexer,
    private agentManager: AgentManager,
    extensionUri: vscode.Uri,
    config?: Partial<GuardianIntegrationConfig>
  ) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.extensionUri = extensionUri;
    this.config = { ...DEFAULT_INTEGRATION_CONFIG, ...config };

    console.log('[GuardianIntegration] Initialized');
  }

  /**
   * Initialize the Guardian integration
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[GuardianIntegration] Disabled, skipping initialization');
      return;
    }

    console.log('[GuardianIntegration] Initializing...');

    // Create output channel
    if (this.config.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('Gently Guardian');
      this.outputChannel.appendLine('🛡️ Gently Guardian initialized');
      this.disposables.push(this.outputChannel);
    }

    // Create status bar item
    if (this.config.statusBarItem) {
      this.createStatusBarItem();
    }

    // Initialize Guardian service
    await this.initializeGuardianService();

    // Initialize background task manager
    this.initializeBackgroundTaskManager();

    // Initialize quick fix service
    this.initializeQuickFixService();

    // Register view provider
    this.registerViewProvider();

    // Register event listeners
    this.registerEventListeners();

    // Commands are registered through CommandRegistry, not here
    // Register VS Code commands
    // this.registerCommands();

    // Start if auto-start is enabled
    if (this.config.autoStart) {
      await this.start();
    }

    console.log('[GuardianIntegration] Initialization complete');
  }

  /**
   * Initialize Guardian service
   */
  private async initializeGuardianService(): Promise<void> {
    this.guardianService = new GuardianService(
      this.workspaceRoot,
      this.relationshipGraph,
      this.memoryManager,
      this.validationManager,
      this.hybridRetriever,
      this.codebaseIndexer
    );

    await this.guardianService.initialize();

    // Listen to Guardian events
    this.guardianService.on('analysisComplete', (result) => {
      this.handleAnalysisComplete(result);
    });

    this.guardianService.on('issueDismissed', (issue) => {
      this.handleIssueDismissed(issue);
    });
  }

  /**
   * Initialize background task manager
   */
  private initializeBackgroundTaskManager(): void {
    if (!this.guardianService) {
      return;
    }

    this.backgroundTaskManager = new BackgroundTaskManager(this.guardianService);

    // Listen to background task events
    this.backgroundTaskManager.on('taskCompleted', (task: any, result: any) => {
      this.log(`✅ Analysis completed: ${task.type} (${result.issues.length} issues found)`);
    });

    this.backgroundTaskManager.on('taskFailed', (task: any, error: any) => {
      this.log(`❌ Analysis failed: ${task.type} - ${error}`);
    });

    this.backgroundTaskManager.on('taskScheduled', (task: any) => {
      this.log(`📋 Analysis scheduled: ${task.type} (${task.priority} priority)`);
    });
  }

  /**
   * Initialize quick fix service
   */
  private initializeQuickFixService(): void {
    this.quickFixService = new QuickFixService();

    // Listen to quick fix events
    this.quickFixService.on('fixApplied', (result) => {
      this.log(`✅ Quick fix applied: ${result.issueId} (${result.duration}ms)`);

      if (this.config.showNotifications) {
        vscode.window.showInformationMessage(
          `Code fix applied successfully!`
        );
      }
    });

    this.quickFixService.on('fixFailed', (result) => {
      this.log(`❌ Quick fix failed: ${result.issueId} - ${result.error}`);

      if (this.config.showNotifications) {
        vscode.window.showErrorMessage(
          `Failed to apply code fix: ${result.error}`
        );
      }
    });
  }

  /**
   * Register view provider
   */
  private registerViewProvider(): void {
    if (!this.guardianService) {
      return;
    }

    this.guardianViewProvider = new GuardianViewProvider(
      this.extensionUri,
      this.guardianService
    );

    this.disposables.push(
      vscode.window.registerWebviewViewProvider(
        GuardianViewProvider.viewType,
        this.guardianViewProvider,
        { webviewOptions: { retainContextWhenHidden: true } }
      )
    );
  }

  /**
   * Register event listeners
   */
  private registerEventListeners(): void {
    // Listen to file changes
    const fileWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceRoot, '**/*')
    );

    fileWatcher.onDidChange(async (uri) => {
      if (this.shouldAnalyzeFile(uri.fsPath)) {
        this.scheduleIncrementalAnalysis([uri.fsPath]);
      }
    });

    fileWatcher.onDidCreate(async (uri) => {
      if (this.shouldAnalyzeFile(uri.fsPath)) {
        this.scheduleIncrementalAnalysis([uri.fsPath]);
      }
    });

    this.disposables.push(fileWatcher);

    // Listen to workspace changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gently.guardian')) {
          this.updateConfiguration();
        }
      })
    );

    // Listen to active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.shouldAnalyzeFile(editor.document.uri.fsPath)) {
          this.updateStatusBarForFile(editor.document.uri.fsPath);
        }
      })
    );
  }

  /**
   * Register VS Code commands
   * NOTE: Commands are now registered through CommandRegistry
   */
  /*private registerCommands(): void {
    const commands = [
      vscode.commands.registerCommand('gently.guardian.start', () => this.start()),
      vscode.commands.registerCommand('gently.guardian.stop', () => this.stop()),
      vscode.commands.registerCommand('gently.guardian.analyzeWorkspace', () => this.analyzeWorkspace()),
      vscode.commands.registerCommand('gently.guardian.analyzeFile', () => this.analyzeActiveFile()),
      vscode.commands.registerCommand('gently.guardian.showIssues', () => this.showIssues()),
      vscode.commands.registerCommand('gently.guardian.dismissAllIssues', () => this.dismissAllIssues()),
      vscode.commands.registerCommand('gently.guardian.openSettings', () => this.openSettings()),
      vscode.commands.registerCommand('gently.guardian.fixAllIssues', () => this.fixAllIssues())
    ];

    this.disposables.push(...commands);
  }*/

  /**
   * Create status bar item
   */
  private createStatusBarItem(): void {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );

    this.statusBarItem.text = '$(shield) Guardian';
    this.statusBarItem.tooltip = 'Gently Guardian - Proactive Code Health';
    this.statusBarItem.command = 'gently.guardian.showIssues';

    this.statusBarItem.show();
    this.disposables.push(this.statusBarItem);
  }

  /**
   * Start the Guardian system
   */
  async start(): Promise<void> {
    if (!this.guardianService || !this.backgroundTaskManager) {
      throw new Error('Guardian not initialized');
    }

    this.log('🚀 Starting Guardian...');

    this.backgroundTaskManager.start();

    // Schedule initial full analysis
    this.scheduleWorkspaceAnalysis();

    this.updateStatusBar('active');

    if (this.config.showNotifications) {
      vscode.window.showInformationMessage(
        '🛡️ Gently Guardian started - Monitoring your code health'
      );
    }

    this.emit('started');
  }

  /**
   * Stop the Guardian system
   */
  async stop(): Promise<void> {
    if (!this.backgroundTaskManager) {
      return;
    }

    this.log('⏹️ Stopping Guardian...');

    this.backgroundTaskManager.stop();
    this.updateStatusBar('inactive');

    if (this.config.showNotifications) {
      vscode.window.showInformationMessage(
        'Gently Guardian stopped'
      );
    }

    this.emit('stopped');
  }

  /**
   * Schedule workspace analysis
   */
  scheduleWorkspaceAnalysis(): void {
    if (!this.backgroundTaskManager) {
      return;
    }

    this.backgroundTaskManager.scheduleFullAnalysis();
  }

  /**
   * Schedule incremental analysis
   */
  scheduleIncrementalAnalysis(changedFiles: string[]): void {
    if (!this.backgroundTaskManager) {
      return;
    }

    this.backgroundTaskManager.scheduleIncrementalAnalysis(changedFiles);
  }

  /**
   * Analyze the entire workspace
   */
  async analyzeWorkspace(): Promise<void> {
    if (!this.guardianService) {
      return;
    }

    this.log('🔍 Starting workspace analysis...');

    try {
      const result = await this.guardianService.performAnalysis([], true);

      if (this.config.showNotifications && result.issues.length > 0) {
        vscode.window.showWarningMessage(
          `Found ${result.issues.length} code health issues in your workspace`
        );
      }

      this.emit('workspaceAnalyzed', result);
    } catch (error) {
      this.log(`❌ Workspace analysis failed: ${error}`);

      if (this.config.showNotifications) {
        vscode.window.showErrorMessage(
          `Workspace analysis failed: ${error}`
        );
      }
    }
  }

  /**
   * Analyze the active file
   */
  async analyzeActiveFile(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      vscode.window.showInformationMessage('No active file to analyze');
      return;
    }

    if (!this.guardianService) {
      return;
    }

    const filePath = activeEditor.document.uri.fsPath;
    this.log(`🔍 Analyzing file: ${filePath}`);

    try {
      const result = await this.guardianService.performAnalysis([filePath], false);

      if (this.config.showNotifications && result.issues.length > 0) {
        vscode.window.showWarningMessage(
          `Found ${result.issues.length} code health issues in ${path.basename(filePath)}`
        );
      }

      this.emit('fileAnalyzed', filePath, result);
    } catch (error) {
      this.log(`❌ File analysis failed: ${error}`);

      if (this.config.showNotifications) {
        vscode.window.showErrorMessage(
          `File analysis failed: ${error}`
        );
      }
    }
  }

  /**
   * Show issues panel
   */
  async showIssues(): Promise<void> {
    if (!this.guardianService) {
      return;
    }

    const issues = this.guardianService.getIssues();

    if (issues.length === 0) {
      vscode.window.showInformationMessage('No code health issues found! 🎉');
      return;
    }

    // Create quick pick with issues
    const items = issues.map(issue => ({
      label: `${this.getSeverityIcon(issue.severity)} ${issue.title}`,
      description: `${path.basename(issue.filePath)}:${issue.lineNumbers?.[0] || 0}`,
      detail: issue.description,
      issue
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Found ${issues.length} code health issues`,
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      await this.handleIssueSelection(selected.issue);
    }
  }

  /**
   * Handle issue selection
   */
  private async handleIssueSelection(issue: GuardianIssue): Promise<void> {
    // Show document and navigate to issue
    const document = await vscode.workspace.openTextDocument(issue.filePath);
    await vscode.window.showTextDocument(document);

    if (issue.lineNumbers && issue.lineNumbers.length > 0) {
      const line = issue.lineNumbers[0] - 1; // VS Code uses 0-based indexing
      const range = new vscode.Range(line, 0, line, 0);

      const editor = vscode.window.activeTextEditor;
      if (editor) {
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    }

    // Show issue actions
    const actions = issue.suggestions.map(suggestion => suggestion.title);
    actions.push('Dismiss Issue');

    const action = await vscode.window.showQuickPick(actions, {
      placeHolder: `What would you like to do with this issue?`
    });

    if (action === 'Dismiss Issue') {
      this.dismissIssue(issue.id);
    } else if (action && this.guardianService) {
      // Handle suggestion action
      const suggestion = issue.suggestions.find(s => s.title === action);
      if (suggestion) {
        await this.handleSuggestion(issue, suggestion);
      }
    }
  }

  /**
   * Handle suggestion action
   */
  private async handleSuggestion(issue: GuardianIssue, suggestion: any): Promise<void> {
    switch (suggestion.action) {
      case 'show_me':
        // Already handled by navigation
        break;
      case 'fix_it':
        await this.applyQuickFix(issue, suggestion);
        break;
      case 'dismiss':
        this.dismissIssue(issue.id);
        break;
    }
  }

  /**
   * Dismiss an issue
   */
  dismissIssue(issueId: string): void {
    if (this.guardianService) {
      this.guardianService.dismissIssue(issueId);
      this.updateStatusBar();
    }
  }

  /**
   * Dismiss all issues
   */
  dismissAllIssues(): void {
    if (!this.guardianService) {
      return;
    }

    const issues = this.guardianService.getIssues();
    for (const issue of issues) {
      this.guardianService.dismissIssue(issue.id);
    }

    this.updateStatusBar();

    if (this.config.showNotifications) {
      vscode.window.showInformationMessage(
        `Dismissed ${issues.length} issues`
      );
    }
  }

  /**
   * Open settings
   */
  openSettings(): void {
    vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'gently.guardian'
    );
  }

  /**
   * Handle analysis complete
   */
  private handleAnalysisComplete(result: any): void {
    this.updateStatusBar();

    if (result.issues.length > 0) {
      this.log(`🔔 Analysis complete: ${result.issues.length} issues found`);
    } else {
      this.log('✅ Analysis complete: No issues found');
    }

    this.emit('analysisComplete', result);
  }

  /**
   * Handle issue dismissed
   */
  private handleIssueDismissed(issue: GuardianIssue): void {
    this.log(`🗑️ Issue dismissed: ${issue.title}`);
    this.updateStatusBar();
    this.emit('issueDismissed', issue);
  }

  /**
   * Update configuration
   */
  private updateConfiguration(): void {
    const config = vscode.workspace.getConfiguration('gently.guardian');

    this.config.enabled = config.get('enabled', true);
    this.config.autoStart = config.get('autoStart', true);
    this.config.showNotifications = config.get('showNotifications', true);
    this.config.statusBarItem = config.get('statusBarItem', true);
    this.config.outputChannel = config.get('outputChannel', true);

    this.log('⚙️ Configuration updated');
  }

  /**
   * Check if file should be analyzed
   */
  private shouldAnalyzeFile(filePath: string): boolean {
    const ext = path.extname(filePath);
    return ['.ts', '.js', '.tsx', '.jsx', '.py'].includes(ext);
  }

  /**
   * Update status bar
   */
  private updateStatusBar(status?: 'active' | 'inactive'): void {
    if (!this.statusBarItem || !this.guardianService) {
      return;
    }

    if (status === 'inactive') {
      this.statusBarItem.text = '$(shield) Guardian (Stopped)';
      this.statusBarItem.color = new vscode.ThemeColor('descriptionForeground');
      return;
    }

    const stats = this.guardianService.getStats();
    const issueCount = stats.totalIssues;

    if (issueCount === 0) {
      this.statusBarItem.text = '$(shield) Guardian ✓';
      this.statusBarItem.color = new vscode.ThemeColor('terminal.ansiGreen');
    } else {
      this.statusBarItem.text = `$(shield) Guardian (${issueCount})`;
      this.statusBarItem.color = new vscode.ThemeColor('terminal.ansiYellow');
    }
  }

  /**
   * Update status bar for specific file
   */
  private updateStatusBarForFile(filePath: string): void {
    if (!this.statusBarItem || !this.guardianService) {
      return;
    }

    const issues = this.guardianService.getIssuesForFile(filePath);
    const issueCount = issues.length;

    if (issueCount === 0) {
      this.statusBarItem.text = '$(shield) Guardian ✓';
      this.statusBarItem.tooltip = `No issues in ${path.basename(filePath)}`;
    } else {
      this.statusBarItem.text = `$(shield) Guardian (${issueCount})`;
      this.statusBarItem.tooltip = `${issueCount} issues in ${path.basename(filePath)}`;
    }
  }

  /**
   * Get severity icon
   */
  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'critical': return '🔴';
      case 'high': return '🟠';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  }

  /**
   * Log message to output channel
   */
  private log(message: string): void {
    if (this.outputChannel) {
      const timestamp = new Date().toLocaleTimeString();
      this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
  }

  /**
   * Get Guardian service
   */
  getGuardianService(): GuardianService | undefined {
    return this.guardianService;
  }

  /**
   * Get background task manager
   */
  getBackgroundTaskManager(): BackgroundTaskManager | undefined {
    return this.backgroundTaskManager;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stop();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables = [];
    this.removeAllListeners();

    console.log('[GuardianIntegration] Disposed');
  }

  /**
   * Apply quick fix
   */
  private async applyQuickFix(issue: GuardianIssue, suggestion: any): Promise<void> {
    if (!this.quickFixService) {
      vscode.window.showInformationMessage(
        'Quick fix service not available'
      );
      return;
    }

    if (!this.quickFixService.canFix(suggestion)) {
      vscode.window.showInformationMessage(
        'This suggestion cannot be automatically fixed'
      );
      return;
    }

    try {
      this.log(`🔧 Applying quick fix for issue: ${issue.id}`);

      const result = await this.quickFixService.applyQuickFix(issue, suggestion);

      if (result.success) {
        this.log(`✅ Quick fix applied successfully`);

        // Show diff dialog if available
        if (result.diff) {
          const action = await vscode.window.showInformationMessage(
            'Code fix applied successfully!',
            'Show Changes',
            'Dismiss'
          );

          if (action === 'Show Changes') {
            await this.showDiff(result.diff);
          }
        }
      } else {
        vscode.window.showErrorMessage(
          `Failed to apply fix: ${result.error}`
        );
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Quick fix failed: ${error}`
      );
    }
  }

  /**
   * Fix all issues
   */
  private async fixAllIssues(): Promise<void> {
    if (!this.guardianService || !this.quickFixService) {
      return;
    }

    const issues = this.guardianService.getIssues();
    const fixableIssues = issues.filter(issue =>
      issue.suggestions.some(suggestion => this.quickFixService!.canFix(suggestion))
    );

    if (fixableIssues.length === 0) {
      vscode.window.showInformationMessage(
        'No issues can be automatically fixed'
      );
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Apply automatic fixes to ${fixableIssues.length} issues?`,
      'Apply All',
      'Cancel'
    );

    if (confirmation !== 'Apply All') {
      return;
    }

    try {
      this.log(`🔧 Applying batch fixes to ${fixableIssues.length} issues`);

      const fixes = fixableIssues.flatMap(issue =>
        issue.suggestions
          .filter(suggestion => this.quickFixService!.canFix(suggestion))
          .map(suggestion => ({ issue, suggestion }))
      );

      const results = await this.quickFixService.applyBatchFixes(fixes);
      const successful = results.filter(r => r.success).length;

      vscode.window.showInformationMessage(
        `Applied ${successful}/${results.length} fixes successfully`
      );

      this.log(`✅ Batch fix complete: ${successful}/${results.length} successful`);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Batch fix failed: ${error}`
      );
    }
  }

  /**
   * Show diff
   */
  private async showDiff(diff: string): Promise<void> {
    // Create a new untitled document with the diff
    const document = await vscode.workspace.openTextDocument({
      content: diff,
      language: 'diff'
    });

    await vscode.window.showTextDocument(document);
  }
}