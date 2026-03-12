/**
 * Guardian View Provider
 * 
 * Provides the webview for the Guardian interface
 */

import * as vscode from 'vscode';
import { GuardianIssue, GuardianStats } from '../types';
import { GuardianService } from '../GuardianService';
import { generateHtml } from '../../views/webview/htmlGenerator';

export class GuardianViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'gently.guardianView';
  
  private _view?: vscode.WebviewView;
  private guardianService: GuardianService;
  private issues: GuardianIssue[] = [];
  private stats: GuardianStats | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    guardianService: GuardianService
  ) {
    this.guardianService = guardianService;
    
    // Listen to Guardian events
    this.guardianService.on('analysisComplete', (result) => {
      this.updateData(result.issues, result.stats);
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      undefined
    );

    // Do NOT call this.refreshData() synchronously here! 
    // Wait for the webview to send the 'ready' message instead.
  }

  /**
   * Update data in the view
   */
  private updateData(issues: GuardianIssue[], stats: GuardianStats): void {
    this.issues = issues;
    this.stats = stats;
    
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateData',
        issues: this.issues,
        stats: this.stats
      });
    }
  }

  private log(level: 'info' | 'warn' | 'error', message: string, ...args: any[]) {
    console[level === 'error' ? 'error' : level](`[GuardianView] ${message}`, ...args);
  }

  /**
   * Refresh data from Guardian service
   */
  private refreshData(): void {
    this.log('info', 'refreshData called');
    this.issues = this.guardianService.getIssues();
    this.stats = this.guardianService.getStats();
    
    if (this.issues.length === 0 && !(this.guardianService as any).isAnalyzing) {
      this.log('info', 'Sending empty updateData to webview (no issues, not analyzing)');
      if (this._view) {
        this._view.webview.postMessage({ 
          type: 'updateData', 
          issues: [], 
          stats: { totalIssues: 0, issuesBySeverity: {} } 
        });
      }
      return;
    }
    
    this.log('info', 'Sending updateData to webview', {
      issueCount: this.issues.length,
      stats: this.stats
    });
    this.updateData(this.issues, this.stats);
  }

  /**
   * Handle messages from the webview
   */
  private handleMessage(message: any): void {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        this.refreshData();
        break;
      case 'dismissIssue':
        this.guardianService.dismissIssue(message.issueId);
        break;
      case 'dismissAllIssues':
        this.dismissAllIssues();
        break;
      case 'navigateToFile':
        this.navigateToFile(message.filePath, message.lineNumber);
        break;
      case 'analyzeWorkspace':
        this.analyzeWorkspace();
        break;
      case 'fixIssue':
        this.fixIssue(message.issueId, message.suggestionId);
        break;
      case 'sendPromptToAgent':
        this.sendPromptToAgent(message);
        break;
      case 'openSettings':
        vscode.commands.executeCommand('gently.guardian.openSettings');
        break;
    }
  }

  /**
   * Dismiss all issues
   */
  private dismissAllIssues(): void {
    for (const issue of this.issues) {
      this.guardianService.dismissIssue(issue.id);
    }
  }

  /**
   * Navigate to file and line
   */
  private async navigateToFile(filePath: string, lineNumber?: number): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(document);
      
      if (lineNumber) {
        const line = lineNumber - 1; // VS Code uses 0-based indexing
        const range = new vscode.Range(line, 0, line, 0);
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  }

  /**
   * Analyze workspace
   */
  private async analyzeWorkspace(): Promise<void> {
    try {
      await this.guardianService.performAnalysis([], true);
    } catch (error) {
      vscode.window.showErrorMessage(`Analysis failed: ${error}`);
    }
  }

  /**
   * Fix an issue (placeholder for Agent mode integration)
   */
  private fixIssue(issueId: string, suggestionId: string): void {
    const issue = this.issues.find(i => i.id === issueId);
    const suggestion = issue?.suggestions.find(s => s.id === suggestionId);
    
    if (suggestion?.action === 'fix_it' && issue) {
      const prompt = `Please fix the following issue in ${issue.filePath}:\n\nTitle: ${issue.title}\nDescription: ${issue.description}\nSuggestion: ${suggestion.title} - ${suggestion.description}`;
      this.sendPromptToAgent({
        prompt: prompt,
        filePath: issue.filePath,
        lineNumber: issue.lineNumbers?.[0]
      });
    } else if (suggestion?.action === 'show_me') {
      if (issue) {
        this.navigateToFile(issue.filePath, issue.lineNumbers?.[0]);
      }
    }
  }

  /**
   * Send prompt to Agent to fix the issue
   */
  private sendPromptToAgent(data: any): void {
    const { prompt, filePath, lineNumber } = data;
    
    // First, navigate to the file
    if (filePath) {
      this.navigateToFile(filePath, lineNumber);
    }
    
    // Send the prompt to the Agent via command
    vscode.commands.executeCommand('gently.chat.sendPrompt', prompt).then(
      () => {
        vscode.window.showInformationMessage('Prompt sent to Agent for analysis');
      },
      (err: any) => {
        vscode.window.showErrorMessage(`Failed to send prompt: ${err}`);
      }
    );
  }

  /**
   * Get HTML for webview
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    return generateHtml(webview, this._extensionUri, { viewType: 'guardian' });
  }

  /**
   * Send a message to the webview
   */
  private postMessage(message: any): void {
    if (this._view) {
      this._view.webview.postMessage(message);
    }
  }

  /**
   * Show the view
   */
  public show(): void {
    if (this._view) {
      this._view.show();
    }
  }

  /**
   * Cleanup when disposed
   */
  public dispose(): void {
    if (this.guardianService && typeof (this.guardianService as any).removeAllListeners === 'function') {
      (this.guardianService as any).removeAllListeners('analysisComplete');
    }
    this._view = undefined;
  }
}