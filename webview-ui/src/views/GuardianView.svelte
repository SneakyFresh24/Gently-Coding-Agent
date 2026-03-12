<script lang="ts">
  import { onMount } from "svelte";

  // State
  let issues = $state<any[]>([]);
  let stats = $state<any>(null);
  let isAnalyzing = $state(false);
  let filterType = $state("all");
  let filterSeverity = $state("all");

  // Filtered Issues
  const filteredIssues = $derived(
    issues.filter(issue => {
      const typeMatch = filterType === 'all' || issue.type === filterType;
      const severityMatch = filterSeverity === 'all' || issue.severity === filterSeverity;
      return typeMatch && severityMatch;
    })
  );

  onMount(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'updateData') {
        issues = message.issues || [];
        stats = message.stats || null;
        isAnalyzing = false;
      }
    };
    
    window.addEventListener('message', handleMessage);
    
    // Signal ready
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  });

  const postMessage = (message: any) => {
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage(message);
    }
  };

  // Actions
  const handleRefresh = () => postMessage({ type: 'refresh' });
  const handleAnalyze = () => {
    isAnalyzing = true;
    postMessage({ type: 'analyzeWorkspace' });
  };
  const handleSettings = () => postMessage({ type: 'openSettings' });
  const handleDismissAll = () => {
    if (issues.length > 0 && confirm(`Are you sure you want to dismiss all ${issues.length} issues?`)) {
      postMessage({ type: 'dismissAllIssues' });
    }
  };

  const navigateToFile = (filePath: string, lineNumber: number) => {
    postMessage({ type: 'navigateToFile', filePath, lineNumber });
  };

  const dismissIssue = (issueId: string) => {
    // Optimistic UI update
    const index = issues.findIndex(i => i.id === issueId);
    if (index !== -1) {
      issues[index] = { ...issues[index], dismissed: true }; 
    }
    postMessage({ type: 'dismissIssue', issueId });
  };

  const fixIssue = (issueId: string, suggestionId: string) => {
    postMessage({ type: 'fixIssue', issueId, suggestionId });
  };

  // Helpers
  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      code_duplication: 'Code Duplication',
      dead_code: 'Dead Code',
      architectural_drift: 'Architectural Drift',
      security_pattern: 'Security Issue',
      performance_issue: 'Performance Issue',
      maintainability: 'Maintainability',
      test_coverage: 'Test Coverage'
    };
    return labels[type] || type;
  };

  const getFileName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath;

  const getEffortLabel = (effort: string) => {
    const labels: Record<string, string> = {
      trivial: '< 5 min',
      low: '5-15 min',
      medium: '15-30 min',
      high: '30-60 min',
      significant: '> 1 hour'
    };
    return labels[effort] || effort;
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      show_me: 'Show Me',
      fix_it: 'Fix It',
      dismiss: 'Dismiss'
    };
    return labels[action] || action;
  };
</script>

<div class="guardian-container">
  <header class="header">
    <div class="title">
      <span class="icon">🛡️</span>
      Gently Guardian
    </div>
    <div class="header-actions">
      <button class="action-button" onclick={handleRefresh} title="Refresh">
        <span>🔄</span> Refresh
      </button>
      <button class="action-button" onclick={handleAnalyze} disabled={isAnalyzing}>
        <span class="icon">{isAnalyzing ? '⏳' : '🔍'}</span> {isAnalyzing ? 'Analysing...' : 'Analyze Workspace'}
      </button>
      <button class="action-button" onclick={handleSettings} title="Settings">
        ⚙️
      </button>
    </div>
  </header>

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-number">{stats?.totalIssues || 0}</div>
      <div class="stat-label">Total Issues</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{stats?.issuesBySeverity.critical || 0}</div>
      <div class="stat-label">Critical</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{stats?.issuesBySeverity.high || 0}</div>
      <div class="stat-label">High</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{stats?.issuesBySeverity.medium || 0}</div>
      <div class="stat-label">Medium</div>
    </div>
    <div class="stat-card">
      <div class="stat-number">{stats?.issuesBySeverity.low || 0}</div>
      <div class="stat-label">Low</div>
    </div>
  </div>

  <div class="issues-section">
    <div class="section-header">
      <h2>Code Health Issues</h2>
      <div class="section-actions">
        <select bind:value={filterType} class="filter-select">
          <option value="all">All Types</option>
          <option value="code_duplication">Code Duplication</option>
          <option value="dead_code">Dead Code</option>
          <option value="architectural_drift">Architectural Drift</option>
          <option value="security_pattern">Security Issues</option>
          <option value="performance_issue">Performance Issues</option>
        </select>
        <select bind:value={filterSeverity} class="filter-select">
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button class="action-button" onclick={handleDismissAll}>
          Dismiss All
        </button>
      </div>
    </div>

    <div class="issues-list">
      {#if filteredIssues.length === 0}
        <div class="empty-state">
          <div class="empty-icon">🎉</div>
          <div class="empty-title">No issues found!</div>
          <p>Your code is healthy. Guardian will continue monitoring.</p>
        </div>
      {:else}
        {#each filteredIssues as issue (issue.id)}
          <div class="issue-item" class:dismissed={issue.dismissed}>
            <div class="issue-header">
              <div class="issue-title-row">
                <span class="severity-badge severity-{issue.severity}">{issue.severity}</span>
                <span class="issue-type-badge">{getTypeLabel(issue.type)}</span>
              </div>
            </div>
            
            <h3 class="issue-heading">{issue.title}</h3>
            
            <button class="issue-location-btn" onclick={() => navigateToFile(issue.filePath, issue.lineNumbers?.[0] || 0)}>
              📁 <span class="file-path">{getFileName(issue.filePath)}{issue.lineNumbers?.length ? `:${issue.lineNumbers[0]}` : ''}</span>
            </button>
            
            <div class="issue-description">
              {issue.description}
            </div>
            
            {#if issue.suggestions?.length}
              <div class="suggestions">
                <h4>Suggestions:</h4>
                {#each issue.suggestions as suggestion}
                  <div class="suggestion-item">
                    <div class="suggestion-title">{suggestion.title}</div>
                    <div class="suggestion-description">{suggestion.description}</div>
                    <div class="suggestion-meta">
                      <div class="confidence-indicator">
                        <span>Confidence:</span>
                        <div class="confidence-bar">
                          <div class="confidence-fill" style="width: {Math.round(suggestion.confidence * 100)}%"></div>
                        </div>
                        <span>{Math.round(suggestion.confidence * 100)}%</span>
                      </div>
                      <span class="effort-indicator">{getEffortLabel(suggestion.estimatedEffort)}</span>
                      <button class="action-button" onclick={() => fixIssue(issue.id, suggestion.id)}>
                        {getActionLabel(suggestion.action)}
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
            
            <div class="issue-actions">
              <button class="action-button" onclick={() => navigateToFile(issue.filePath, issue.lineNumbers?.[0] || 0)}>
                <span class="icon">📍</span> Show Me
              </button>
              <button class="action-button" onclick={() => dismissIssue(issue.id)}>
                <span class="icon">🗑️</span> Dismiss
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  :root {
    --bg-primary: rgba(30, 30, 38, 0.55);
    --bg-secondary: rgba(20, 20, 28, 0.65);
    --bg-surface: rgba(40, 40, 52, 0.45);
    --border-subtle: rgba(255, 255, 255, 0.08);
    --border-strong: rgba(168, 85, 247, 0.25);
    --text-primary: rgba(255, 255, 255, 0.92);
    --text-secondary: rgba(255, 255, 255, 0.65);
    --text-muted: rgba(255, 255, 255, 0.45);
    --accent: rgb(168, 85, 247);
    --accent-dim: rgba(168, 85, 247, 0.18);
    --success: rgb(34, 197, 94);
    --warning: rgb(245, 158, 11);
    --danger: rgb(239, 68, 68);
    --danger-dim: rgba(239, 68, 68, 0.18);
    --radius-sm: 0.375rem;
    --radius-md: 0.75rem;
    --transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .guardian-container {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    backdrop-filter: blur(20px);
    color: var(--text-primary);
    overflow: hidden;
  }

  .header {
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
  }

  .stat-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
    text-align: center;
    transition: var(--transition);
  }

  .stat-card:hover {
    background: rgba(168, 85, 247, 0.08);
    border-color: var(--border-strong);
  }

  .stat-number {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--accent);
  }

  .stat-label {
    font-size: 0.65rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .issues-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .section-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border-subtle);
  }

  .section-header h2 {
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
    opacity: 0.8;
  }

  .section-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .filter-select {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.5rem;
    font-size: 0.8rem;
  }

  .issues-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
  }

  .issue-item {
    background: var(--bg-surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 1rem;
    margin-bottom: 1rem;
    transition: var(--transition);
  }

  .issue-item:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }

  .issue-item.dismissed {
    opacity: 0.5;
    pointer-events: none;
  }

  .issue-title-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .severity-badge {
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .severity-critical { background: var(--danger-dim); color: var(--danger); border: 1px solid var(--danger); }
  .severity-high     { background: rgba(245,158,11,0.15); color: var(--warning); border: 1px solid var(--warning); }
  .severity-medium   { background: rgba(168,85,247,0.12); color: var(--accent); border: 1px solid var(--accent); }
  .severity-low      { background: rgba(34,197,94,0.12); color: var(--success); border: 1px solid var(--success); }

  .issue-type-badge {
    font-size: 0.7rem;
    background: rgba(255, 255, 255, 0.05);
    padding: 0.2rem 0.5rem;
    border-radius: 1rem;
    color: var(--text-secondary);
  }

  .issue-heading {
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }

  .issue-location-btn {
    background: transparent;
    border: none;
    font-size: 0.8rem;
    color: var(--accent);
    cursor: pointer;
    margin-bottom: 0.75rem;
    padding: 0;
    text-align: left;
    display: block;
    width: 100%;
  }

  .issue-location-btn:hover .file-path {
    text-decoration: underline;
  }

  .issue-description {
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text-secondary);
    margin-bottom: 1rem;
  }

  .suggestions {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
  }

  .suggestions h4 {
    font-size: 0.8rem;
    margin-bottom: 0.75rem;
    opacity: 0.7;
  }

  .suggestion-item {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .suggestion-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--accent);
    margin-bottom: 0.25rem;
  }

  .suggestion-description {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .suggestion-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .confidence-indicator {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.7rem;
  }

  .confidence-bar {
    width: 50px;
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
  }

  .confidence-fill {
    height: 100%;
    background: var(--accent);
  }

  .effort-indicator {
    font-size: 0.7rem;
    background: rgba(255,255,255,0.05);
    padding: 0.15rem 0.4rem;
    border-radius: 1rem;
  }

  .issue-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .action-button {
    background: var(--accent-dim);
    border: 1px solid var(--border-strong);
    color: var(--accent);
    padding: 0.35rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: var(--transition);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .action-button:hover:not(:disabled) {
    background: rgba(168, 85, 247, 0.3);
    transform: translateY(-1px);
  }

  .action-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 1.5rem;
    color: var(--text-muted);
  }

  .empty-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .empty-title {
    font-size: 1.25rem;
    color: var(--text-primary);
    margin-bottom: 0.5rem;
  }
</style>
