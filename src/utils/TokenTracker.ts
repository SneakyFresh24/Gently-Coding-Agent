import * as vscode from 'vscode';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class TokenTracker {
  private static readonly STORAGE_KEY = 'gently.tokenUsage';
  private usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  constructor(private context: vscode.ExtensionContext) {
    this.loadUsage();
  }

  private loadUsage() {
    const saved = this.context.globalState.get<TokenUsage>(TokenTracker.STORAGE_KEY);
    if (saved) {
      this.usage = saved;
    }
  }

  public trackUsage(usage: Partial<TokenUsage>) {
    this.usage.promptTokens += usage.promptTokens || 0;
    this.usage.completionTokens += usage.completionTokens || 0;
    this.usage.totalTokens += usage.totalTokens || 0;
    
    this.saveUsage();
  }

  private async saveUsage() {
    await this.context.globalState.update(TokenTracker.STORAGE_KEY, this.usage);
  }

  public getUsage(): TokenUsage {
    return { ...this.usage };
  }

  public resetUsage() {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.saveUsage();
  }
}
