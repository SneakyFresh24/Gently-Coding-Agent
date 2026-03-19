<script lang="ts">
  export let tokens = 0;
  export let maxTokens = 200000;
  
  $: percentage = Math.min(100, Math.round((tokens / maxTokens) * 100));
  $: formattedTokens = tokens.toLocaleString();
  $: formattedMax = (maxTokens / 1000).toFixed(0) + 'k';
</script>

<div class="token-display">
  <div class="stats">
    <span class="count">{formattedTokens}</span>
    <span class="divider">/</span>
    <span class="max">{formattedMax}</span>
  </div>
  <div class="progress-bar">
    <div class="fill" style="width: {percentage}%"></div>
  </div>
</div>

<style>
  .token-display {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 100px;
    padding: 0 8px;
  }

  .stats {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif);
    color: var(--vscode-descriptionForeground);
  }

  .count {
    color: var(--vscode-foreground);
    font-weight: 600;
  }

  .progress-bar {
    height: 3px;
    background: var(--vscode-widget-border);
    border-radius: 2px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--vscode-progressBar-background);
    transition: width 0.3s ease;
  }
</style>
