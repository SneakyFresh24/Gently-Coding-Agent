<script lang="ts">
  import ContextWindowSummary from '../chat/ContextWindowSummary.svelte';
  
  export let tokens = 0;
  export let maxTokens = 200000;
  export let promptTokens = 0;
  export let completionTokens = 0;
  export let cacheReads = 0;
  export let cacheWrites = 0;
  export let pricing: { prompt?: number; completion?: number; cache_read?: number; cache_write?: number } | null = null;
  export let cost: number | null = null;
  
  let isHovered = false;
  
  $: percentage = Math.min(100, Math.round((tokens / maxTokens) * 100));
  $: formattedTokens = formatLargeNumber(tokens);
  $: formattedMax = formatLargeNumber(maxTokens);
  $: thresholdClass = percentage >= 95 ? 'critical' : percentage >= 90 ? 'danger' : percentage >= 75 ? 'warning' : 'safe';

  function formatLargeNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return Math.round(value).toString();
  }
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
    <div class="fill {thresholdClass}" style="transform: translateX(-{100 - percentage}%);"></div>
  </div>

  {#if isHovered}
    <div class="hover-card">
      <ContextWindowSummary
        {tokens}
        {maxTokens}
        {promptTokens}
        {completionTokens}
        {cacheReads}
        {cacheWrites}
        {pricing}
        {cost}
      />
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
    width: 100%;
    background: var(--vscode-progressBar-background);
    transform: translateX(-100%);
    transition: transform 0.25s ease, background-color 0.2s ease;
  }

  .fill.warning {
    background: #d9a441;
  }

  .fill.danger {
    background: #d97341;
  }

  .fill.critical {
    background: #d94a41;
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
