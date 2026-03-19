<script lang="ts">
  export let tokens = 0;
  export let maxTokens = 200000;
  export let cost = 0;
  export let cacheReads = 0;
  export let cacheWrites = 0;

  $: percentage = Math.min(100, Math.round((tokens / maxTokens) * 100));
  $: formattedTokens = tokens.toLocaleString();
  $: formattedMax = (maxTokens / 1000).toFixed(0) + 'k';
  $: formattedCost = cost > 0 ? `$${cost.toFixed(4)}` : '$0.0000';
</script>

<div class="context-summary">
  <div class="summary-header">
    <span class="title">Context Window</span>
    <span class="percentage">{percentage}%</span>
  </div>

  <div class="progress-container">
    <div class="progress-bar">
      <div class="fill" style="width: {percentage}%"></div>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-item">
      <span class="label">Tokens Used</span>
      <span class="value">{formattedTokens}</span>
    </div>
    <div class="stat-item">
      <span class="label">Total Limit</span>
      <span class="value">{formattedMax}</span>
    </div>
    <div class="stat-item">
      <span class="label">Estimated Cost</span>
      <span class="value">{formattedCost}</span>
    </div>
  </div>

  {#if cacheReads > 0 || cacheWrites > 0}
    <div class="divider"></div>
    <div class="cache-info">
      <div class="stat-item">
        <span class="label">Cache Reads</span>
        <span class="value">{cacheReads.toLocaleString()}</span>
      </div>
      <div class="stat-item">
        <span class="label">Cache Writes</span>
        <span class="value">{cacheWrites.toLocaleString()}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .context-summary {
    padding: 12px;
    min-width: 200px;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    font-size: 11px;
    pointer-events: none;
  }

  .summary-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .title {
    font-weight: 600;
    opacity: 0.9;
  }

  .percentage {
    color: var(--vscode-progressBar-background);
    font-weight: 700;
  }

  .progress-container {
    height: 4px;
    background: var(--vscode-widget-border);
    border-radius: 2px;
    margin-bottom: 12px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--vscode-progressBar-background);
  }

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }

  .value {
    font-family: var(--vscode-editor-font-family);
  }

  .divider {
    height: 1px;
    background: var(--vscode-widget-border);
    margin: 8px 0;
  }

  .cache-info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
</style>
