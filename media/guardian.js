/**
 * Gently Guardian - JavaScript for Webview
 */

(function() {
  'use strict';

  // State
  let issues = [];
  let stats = null;
  let currentFilter = {
    type: 'all',
    severity: 'all'
  };

  // DOM Elements
  const elements = {
    totalIssues: document.getElementById('totalIssues'),
    criticalIssues: document.getElementById('criticalIssues'),
    highIssues: document.getElementById('highIssues'),
    mediumIssues: document.getElementById('mediumIssues'),
    lowIssues: document.getElementById('lowIssues'),
    filterType: document.getElementById('filterType'),
    filterSeverity: document.getElementById('filterSeverity'),
    issuesList: document.getElementById('issuesList'),
    refreshBtn: document.getElementById('refreshBtn'),
    analyzeBtn: document.getElementById('analyzeBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    dismissAllBtn: document.getElementById('dismissAllBtn')
  };

  // Initialize
  function init() {
    setupEventListeners();
    showMessage('loading', 'Initializing Guardian...');
  }

  // Setup event listeners
  function setupEventListeners() {
    // Button clicks
    elements.refreshBtn.addEventListener('click', () => {
      postMessage({ type: 'refresh' });
    });

    elements.analyzeBtn.addEventListener('click', () => {
      elements.analyzeBtn.disabled = true;
      elements.analyzeBtn.innerHTML = '<span class="icon">⏳</span> Analyzing...';
      postMessage({ type: 'analyzeWorkspace' });
    });

    elements.settingsBtn.addEventListener('click', () => {
      postMessage({ type: 'openSettings' });
    });

    elements.dismissAllBtn.addEventListener('click', () => {
      if (issues.length === 0) return;
      
      if (confirm(`Are you sure you want to dismiss all ${issues.length} issues?`)) {
        postMessage({ type: 'dismissAllIssues' });
      }
    });

    // Filter changes
    elements.filterType.addEventListener('change', (e) => {
      currentFilter.type = e.target.value;
      renderIssues();
    });

    elements.filterSeverity.addEventListener('change', (e) => {
      currentFilter.severity = e.target.value;
      renderIssues();
    });
  }

  // Handle messages from extension
  function handleMessage(event) {
    const message = event.data;
    
    switch (message.type) {
      case 'updateData':
        issues = message.issues || [];
        stats = message.stats || null;
        updateStats();
        renderIssues();
        hideMessage();
        
        // Reset analyze button
        elements.analyzeBtn.disabled = false;
        elements.analyzeBtn.innerHTML = '<span class="icon">🔍</span> Analyze Workspace';
        break;
    }
  }

  // Update statistics display
  function updateStats() {
    if (!stats) return;

    elements.totalIssues.textContent = stats.totalIssues || 0;
    elements.criticalIssues.textContent = stats.issuesBySeverity.critical || 0;
    elements.highIssues.textContent = stats.issuesBySeverity.high || 0;
    elements.mediumIssues.textContent = stats.issuesBySeverity.medium || 0;
    elements.lowIssues.textContent = stats.issuesBySeverity.low || 0;
  }

  // Render issues list
  function renderIssues() {
    const filteredIssues = filterIssues();
    
    if (filteredIssues.length === 0) {
      renderEmptyState();
      return;
    }

    const issuesHtml = filteredIssues.map(issue => renderIssue(issue)).join('');
    elements.issuesList.innerHTML = issuesHtml;

    // Add event listeners to issue actions
    setupIssueEventListeners();
  }

  // Filter issues based on current filters
  function filterIssues() {
    return issues.filter(issue => {
      const typeMatch = currentFilter.type === 'all' || issue.type === currentFilter.type;
      const severityMatch = currentFilter.severity === 'all' || issue.severity === currentFilter.severity;
      return typeMatch && severityMatch;
    });
  }

  // Render empty state
  function renderEmptyState() {
    elements.issuesList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <div class="empty-title">No issues found!</div>
        <div class="empty-description">
          Your code is healthy. Guardian will continue monitoring for issues.
        </div>
      </div>
    `;
  }

  // Render single issue
  function renderIssue(issue) {
    const severityClass = issue.severity;
    const typeLabel = getTypeLabel(issue.type);
    const fileName = getFileName(issue.filePath);
    const lineNumber = issue.lineNumbers && issue.lineNumbers.length > 0 
      ? `:${issue.lineNumbers[0]}` 
      : '';

    return `
      <div class="issue-item" data-issue-id="${issue.id}">
        <div class="issue-header">
          <div class="issue-title">
            <span class="severity-badge ${severityClass}">${issue.severity}</span>
            <span class="issue-type">${typeLabel}</span>
          </div>
        </div>
        
        <h3 class="issue-heading">${escapeHtml(issue.title)}</h3>
        
        <div class="issue-location">
          📁 <span class="file-path" data-file-path="${issue.filePath}" data-line-number="${issue.lineNumbers?.[0] || 0}">${fileName}${lineNumber}</span>
        </div>
        
        <div class="issue-description">
          ${escapeHtml(issue.description)}
        </div>
        
        ${renderSuggestions(issue)}
        
        <div class="issue-actions">
          <button class="btn btn-sm btn-secondary action-dismiss" data-issue-id="${issue.id}">
            <span class="icon">🗑️</span>
            Dismiss
          </button>
        </div>
      </div>
    `;
  }

  // Render suggestions for an issue
  function renderSuggestions(issue) {
    if (!issue.suggestions || issue.suggestions.length === 0) {
      return '';
    }

    return `
      <div class="suggestions">
        <h4>Suggestions:</h4>
        ${issue.suggestions.map(suggestion => renderSuggestion(issue.id, suggestion)).join('')}
      </div>
    `;
  }

  // Render single suggestion
  function renderSuggestion(issueId, suggestion) {
    const effortLabel = getEffortLabel(suggestion.estimatedEffort);
    const confidencePercent = Math.round(suggestion.confidence * 100);
    const issue = issues.find(i => i.id === issueId);
    
    let buttonsHtml = '';
    
    if (suggestion.action === 'show_me') {
      buttonsHtml = `
        <button class="btn btn-sm btn-primary action-suggestion" data-issue-id="${issueId}" data-suggestion-id="${suggestion.id}" data-action="${suggestion.action}">
          <span class="icon">📍</span>
          ${getActionLabel(suggestion.action)}
        </button>
        <button class="btn btn-sm btn-success action-fix-with-agent" data-issue-id="${issueId}" data-suggestion-id="${suggestion.id}">
          <span class="icon">🤖</span>
          Fix It
        </button>
      `;
    } else {
      const actionClass = suggestion.action === 'fix_it' ? 'btn-success' : 'btn-primary';
      buttonsHtml = `
        <button class="btn btn-sm ${actionClass} action-suggestion" data-issue-id="${issueId}" data-suggestion-id="${suggestion.id}" data-action="${suggestion.action}">
          ${getActionLabel(suggestion.action)}
        </button>
      `;
    }

    return `
      <div class="suggestion-item">
        <div class="suggestion-title">${escapeHtml(suggestion.title)}</div>
        <div class="suggestion-description">${escapeHtml(suggestion.description)}</div>
        <div class="suggestion-meta">
          <div class="confidence-indicator">
            <span>Confidence:</span>
            <div class="confidence-bar">
              <div class="confidence-fill" style="width: ${confidencePercent}%"></div>
            </div>
            <span>${confidencePercent}%</span>
          </div>
          <span class="effort-indicator">${effortLabel}</span>
          <div style="display: flex; gap: 8px;">
            ${buttonsHtml}
          </div>
        </div>
      </div>
    `;
  }

  // Setup event listeners for issue actions
  function setupIssueEventListeners() {
    // Navigate to file
    document.querySelectorAll('.action-navigate, .file-path').forEach(element => {
      element.addEventListener('click', (e) => {
        const filePath = e.currentTarget.dataset.filePath;
        const lineNumber = parseInt(e.currentTarget.dataset.lineNumber) || 0;
        postMessage({ type: 'navigateToFile', filePath, lineNumber });
      });
    });

    // Dismiss issue
    document.querySelectorAll('.action-dismiss').forEach(element => {
      element.addEventListener('click', (e) => {
        const issueId = e.currentTarget.dataset.issueId;
        const issueElement = document.querySelector(`[data-issue-id="${issueId}"]`);
        
        if (issueElement) {
          issueElement.style.opacity = '0.5';
          issueElement.style.pointerEvents = 'none';
        }
        
        postMessage({ type: 'dismissIssue', issueId });
      });
    });

    // Fix with Agent button
    document.querySelectorAll('.action-fix-with-agent').forEach(element => {
      element.addEventListener('click', (e) => {
        const issueId = e.currentTarget.dataset.issueId;
        const issue = issues.find(i => i.id === issueId);
        
        if (issue) {
          const prompt = `Please help me fix this code duplication issue:

**Issue:** ${issue.title}
**Description:** ${issue.description}
**Files affected:** ${issue.lineNumbers?.map((line, idx) => `${issue.filePath}:${line}`).join(', ')}
**Suggestion:** ${issue.suggestions[0]?.description || 'Extract to shared utility'}

Please:
1. Navigate to the first location and show me the duplicated code
2. Suggest a refactored solution that removes the duplication
3. Help me implement the fix`;
          
          postMessage({ 
            type: 'sendPromptToAgent', 
            prompt: prompt,
            issueId: issue.id,
            filePath: issue.filePath,
            lineNumber: issue.lineNumbers?.[0] || 0
          });
        }
      });
    });

    // Suggestion actions
    document.querySelectorAll('.action-suggestion').forEach(element => {
      element.addEventListener('click', (e) => {
        const issueId = e.currentTarget.dataset.issueId;
        const suggestionId = e.currentTarget.dataset.suggestionId;
        const action = e.currentTarget.dataset.action;
        
        if (action === 'show_me') {
          // For show_me action, directly navigate
          const issue = issues.find(i => i.id === issueId);
          if (issue) {
            const lineNumber = issue.lineNumbers && issue.lineNumbers.length > 0 
              ? issue.lineNumbers[0] 
              : 0;
            postMessage({ type: 'navigateToFile', filePath: issue.filePath, lineNumber });
          }
        } else if (action === 'fix_it') {
          e.currentTarget.disabled = true;
          e.currentTarget.innerHTML = '<span class="icon">⏳</span> Working...';
          postMessage({ type: 'fixIssue', issueId, suggestionId });
        }
      });
    });
  }

  // Get type label
  function getTypeLabel(type) {
    const labels = {
      code_duplication: 'Code Duplication',
      dead_code: 'Dead Code',
      architectural_drift: 'Architectural Drift',
      security_pattern: 'Security Issue',
      performance_issue: 'Performance Issue',
      maintainability: 'Maintainability',
      test_coverage: 'Test Coverage'
    };
    return labels[type] || type;
  }

  // Get effort label
  function getEffortLabel(effort) {
    const labels = {
      trivial: '< 5 min',
      low: '5-15 min',
      medium: '15-30 min',
      high: '30-60 min',
      significant: '> 1 hour'
    };
    return labels[effort] || effort;
  }

  // Get action label
  function getActionLabel(action) {
    const labels = {
      show_me: 'Show Me',
      fix_it: 'Fix It',
      dismiss: 'Dismiss'
    };
    return labels[action] || action;
  }

  // Get file name from path
  function getFileName(filePath) {
    return filePath.split(/[\\/]/).pop() || filePath;
  }

  // Escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Show message
  function showMessage(type, text) {
    const messageHtml = `
      <div class="loading-state">
        ${type === 'loading' ? '<div class="loading-spinner"></div>' : ''}
        <div>${text}</div>
      </div>
    `;
    elements.issuesList.innerHTML = messageHtml;
  }

  // Hide message
  function hideMessage() {
    // Message will be hidden when issues are rendered
  }

  // Post message to extension
  function postMessage(message) {
    // Acquire VS Code API
    const vscode = acquireVsCodeApi();
    vscode.postMessage(message);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Listen for messages from extension
  window.addEventListener('message', handleMessage);

})();