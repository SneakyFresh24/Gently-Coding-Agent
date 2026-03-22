<script lang="ts">
  export let currentContextTokens = 0;
  export let maxTokens = 200000;
  export let sessionTotalTokens = 0;
  export let promptTokens = 0;
  export let completionTokens = 0;
  export let cost: number | null = null;
  export let cacheReads = 0;
  export let cacheWrites = 0;
  export let pricing: { prompt?: number; completion?: number; cache_read?: number; cache_write?: number } | null = null;
  export let compressionLevel: 'none' | 'proactive' | 'aggressive' = 'none';
  export let warnings: string[] = [];

  $: percentage = Math.min(100, Math.round((currentContextTokens / maxTokens) * 100));
  $: formattedTokens = formatLargeNumber(currentContextTokens);
  $: formattedSessionTotal = formatLargeNumber(sessionTotalTokens);
  $: formattedMax = formatLargeNumber(maxTokens);
  $: resolvedCost = cost ?? calculateEstimatedCost();
  $: hasPricing = !!pricing && [pricing.prompt, pricing.completion, pricing.cache_read, pricing.cache_write].some((v) => (v || 0) > 0);
  $: formattedCost = resolvedCost == null ? 'N/A' : `$${resolvedCost.toFixed(4)}`;
  $: thresholdClass = percentage >= 95 ? 'critical' : percentage >= 80 ? 'warning' : 'safe';
  $: warningText = warnings.length > 0
    ? warnings[0]
    : compressionLevel === 'aggressive'
      ? `Context fast voll (${percentage}%). Aggressive Komprimierung aktiv.`
      : compressionLevel === 'proactive'
        ? `Context zu ${percentage}% gefuellt. Aeltere Nachrichten werden komprimiert.`
        : '';

  function formatLargeNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return Math.round(value).toString();
  }

  function calculateEstimatedCost(): number | null {
    if (!pricing) return null;
    const promptPrice = pricing.prompt ?? 0;
    const completionPrice = pricing.completion ?? 0;
    const cacheReadPrice = pricing.cache_read ?? 0;
    const cacheWritePrice = pricing.cache_write ?? 0;
    if (![promptPrice, completionPrice, cacheReadPrice, cacheWritePrice].some((v) => v > 0)) {
      return null;
    }

    return (
      (promptPrice / 1_000_000) * promptTokens +
      (completionPrice / 1_000_000) * completionTokens +
      (cacheReadPrice / 1_000_000) * cacheReads +
      (cacheWritePrice / 1_000_000) * cacheWrites
    );
  }
</script>

<div class="context-summary">
  <div class="summary-header">
    <span class="title">Context Window</span>
    <span class="percentage {thresholdClass}">{percentage}%</span>
  </div>

  <div class="progress-container">
    <div class="progress-bar">
      <div class="fill {thresholdClass}" style="transform: translateX(-{100 - percentage}%);"></div>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-item">
      <span class="label">Current Context</span>
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

  <div class="divider"></div>
  <div class="cache-info">
    <div class="stat-item">
      <span class="label">Session Input</span>
      <span class="value">{formatLargeNumber(promptTokens)}</span>
    </div>
    <div class="stat-item">
      <span class="label">Session Output</span>
      <span class="value">{formatLargeNumber(completionTokens)}</span>
    </div>
    <div class="stat-item">
      <span class="label">Session Total</span>
      <span class="value">{formattedSessionTotal}</span>
    </div>
  </div>

  {#if warningText}
    <div class="divider"></div>
    <div class="warning {thresholdClass}">{warningText}</div>
  {/if}

  {#if cacheReads > 0 || cacheWrites > 0}
    <div class="divider"></div>
    <div class="cache-info">
      <div class="stat-item">
        <span class="label">Cache Reads</span>
        <span class="value">{formatLargeNumber(cacheReads)}</span>
      </div>
      <div class="stat-item">
        <span class="label">Cache Writes</span>
        <span class="value">{formatLargeNumber(cacheWrites)}</span>
      </div>
    </div>
  {/if}

  {#if !hasPricing}
    <div class="divider"></div>
    <div class="pricing-note">Pricing unavailable for this model.</div>
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

  .percentage.warning {
    color: #d9a441;
  }

  .percentage.critical {
    color: #d94a41;
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
    width: 100%;
    background: var(--vscode-progressBar-background);
    transform: translateX(-100%);
    transition: transform 0.25s ease, background-color 0.2s ease;
  }

  .fill.warning {
    background: #d9a441;
  }

  .fill.critical {
    background: #d94a41;
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

  .pricing-note {
    color: var(--vscode-descriptionForeground);
    font-size: 10px;
  }

  .warning {
    font-size: 10px;
    color: #d9a441;
    line-height: 1.3;
  }

  .warning.critical {
    color: #d94a41;
  }
</style>
