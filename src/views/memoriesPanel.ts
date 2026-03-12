import * as vscode from 'vscode';
import { AgentManager } from '../agent/agentManager/AgentManager';
import { MemoryCategory } from '../agent/memory';

export class MemoriesPanel {
  public static currentPanel: MemoriesPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _agentManager: AgentManager;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, agentManager: AgentManager) {
    const column = vscode.ViewColumn.One;

    if (MemoriesPanel.currentPanel) {
      MemoriesPanel.currentPanel._panel.reveal(column);
      MemoriesPanel.currentPanel._sendMemoriesUpdate();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'gentlyMemories',
      '🧠 Agent Memories',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'webview-dist')]
      }
    );

    MemoriesPanel.currentPanel = new MemoriesPanel(panel, extensionUri, agentManager);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, agentManager: AgentManager) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._agentManager = agentManager;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'ready':
            this._sendMemoriesUpdate();
            break;
          case 'addMemory':
            await this.handleAddMemory(message.content, message.category);
            break;
          case 'deleteMemory':
            await this.handleDeleteMemory(message.id);
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private async handleAddMemory(content: string, category?: MemoryCategory) {
    try {
      await this._agentManager.addMemory(content, 'manual', category);
      vscode.window.showInformationMessage('✅ Memory added');
      this._sendMemoriesUpdate();
    } catch (error) {
      vscode.window.showErrorMessage(`❌ Error: ${error}`);
    }
  }

  private async handleDeleteMemory(id: string) {
    try {
      const success = await this._agentManager.deleteMemory(id);
      if (success) {
        vscode.window.showInformationMessage('✅ Memory deleted');
        this._sendMemoriesUpdate();
      }
    } catch (error) {
      vscode.window.showErrorMessage(`❌ Error: ${error}`);
    }
  }

  private _sendMemoriesUpdate() {
    const memories = this._agentManager.getAllMemories();
    const stats = this._agentManager.getMemoryStats();
    this._panel.webview.postMessage({ type: 'memoriesUpdate', memories, stats });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: 13px;
      line-height: 1.6;
    }

    h1 {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.5px;
    }

    /* Add Memory Section */
    .add-memory {
      margin-bottom: 24px;
      padding: 20px;
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    textarea {
      width: 100%;
      min-height: 100px;
      padding: 12px;
      margin-bottom: 12px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--vscode-input-foreground);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      resize: vertical;
      transition: all 0.2s ease;
    }

    textarea:focus {
      outline: none;
      border-color: rgba(14, 165, 233, 0.5);
      background: rgba(255, 255, 255, 0.08);
      box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
    }

    textarea::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }

    /* Form Controls */
    .form-controls {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    select {
      flex: 0 0 auto;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--vscode-foreground);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    select:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.15);
    }

    select:focus {
      outline: none;
      border-color: rgba(14, 165, 233, 0.5);
      box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
    }

    button {
      padding: 10px 20px;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.9), rgba(59, 130, 246, 0.9));
      color: white;
      border: none;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 4px rgba(14, 165, 233, 0.2);
    }

    button:hover {
      background: linear-gradient(135deg, rgba(14, 165, 233, 1), rgba(59, 130, 246, 1));
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(14, 165, 233, 0.3);
    }

    button:active {
      transform: translateY(0);
    }

    /* Memory Cards */
    .memory-card {
      margin-bottom: 16px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.03);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      transition: all 0.2s ease;
    }

    .memory-card:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.12);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .memory-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .memory-category {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      background: rgba(59, 130, 246, 0.15);
      color: rgb(96, 165, 250);
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .memory-content {
      color: var(--vscode-foreground);
      line-height: 1.6;
      margin-bottom: 8px;
    }

    .memory-meta {
      font-size: 11px;
      color: rgba(255, 255, 255, 0.4);
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
    }

    .delete-btn {
      padding: 6px 14px;
      background: rgba(239, 68, 68, 0.15);
      color: rgb(248, 113, 113);
      border: 1px solid rgba(239, 68, 68, 0.3);
      font-size: 12px;
      box-shadow: none;
    }

    .delete-btn:hover {
      background: rgba(239, 68, 68, 0.25);
      border-color: rgba(239, 68, 68, 0.5);
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(239, 68, 68, 0.2);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: rgba(255, 255, 255, 0.4);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.3;
    }

    /* Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.02);
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  </style>
</head>
<body>
  <h1>🧠 Agent Memories</h1>

  <div class="add-memory">
    <textarea id="content" placeholder="Enter memory content..."></textarea>
    <div class="form-controls">
      <select id="category">
        <option value="">Auto-detect</option>
        <option value="preference">Preference</option>
        <option value="codebase">Codebase</option>
        <option value="workflow">Workflow</option>
        <option value="tech-stack">Tech Stack</option>
        <option value="general">General</option>
      </select>
      <button onclick="addMemory()">Add Memory</button>
    </div>
  </div>

  <div id="memories"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let memories = [];
    vscode.postMessage({ type: 'ready' });
    window.addEventListener('message', e => {
      if (e.data.type === 'memoriesUpdate') {
        memories = e.data.memories;
        render();
      }
    });
    function addMemory() {
      const content = document.getElementById('content').value.trim();
      if (!content) return;
      vscode.postMessage({ type: 'addMemory', content, category: document.getElementById('category').value || undefined });
      document.getElementById('content').value = '';
    }
    function deleteMemory(id) {
      vscode.postMessage({ type: 'deleteMemory', id });
    }
    function render() {
      const memoriesEl = document.getElementById('memories');

      if (memories.length === 0) {
        memoriesEl.innerHTML = \`
          <div class="empty-state">
            <div class="empty-state-icon">🧠</div>
            <div>No memories yet. Add your first memory above!</div>
          </div>
        \`;
        return;
      }

      memoriesEl.innerHTML = memories.map(m => \`
        <div class="memory-card">
          <div class="memory-header">
            <span class="memory-category">\${m.category}</span>
            <button class="delete-btn" onclick="deleteMemory('\${m.id}')">Delete</button>
          </div>
          <div class="memory-content">\${m.content}</div>
          <div class="memory-meta">
            Created: \${new Date(m.metadata.createdAt).toLocaleDateString()} •
            Used: \${m.metadata.useCount} times
          </div>
        </div>
      \`).join('');
    }
  </script>
</body>
</html>`;
  }

  public dispose() {
    MemoriesPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
