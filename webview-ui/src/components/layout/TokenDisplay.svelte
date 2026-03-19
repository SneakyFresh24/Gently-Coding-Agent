<script lang="ts">
  import ContextWindowSummary from '../chat/ContextWindowSummary.svelte';
  
  export let tokens = 0;
  export let maxTokens = 200000;
  
  let isHovered = false;
  
  $: percentage = Math.min(100, Math.round((tokens / maxTokens) * 100));
  $: formattedTokens = tokens.toLocaleString();
  $: formattedMax = (maxTokens / 1000).toFixed(0) + 'k';
</script>

<div 
  class="token-display"
  on:mouseenter={() => isHovered = true}
  on:mouseleave={() => isHovered = false}
  role="status"
  aria-label="Token usage"
  title="Token Usage Details"
>
  <div class="stats">
    <span class="count">{formattedTokens}</span>
    <span class="divider-text">/</span>
    <span class="max">{formattedMax}</span>
  </div>
  <div class="progress-bar">
    <div class="fill" style="width: {percentage}%"></div>
  </div>

  {#if isHovered}
    <div class="hover-card">
      <ContextWindowSummary {tokens} {maxTokens} />
    </div>
  {/if}
</div>

<style>
  .token-display {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 80px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: help;
    transition: background 0.2s;
  }

  .token-display:hover {
    background: var(--vscode-toolbar-hoverBackground);
  }

  .stats {
    display: flex;
    align-items: center;
    gap: 2px;
    font-size: 10px;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
  }

  .count {
    color: var(--vscode-foreground);
    font-weight: 600;
  }

  .divider-text {
    opacity: 0.5;
    margin: 0 1px;
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

  .hover-card {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 2000;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }
</style>
