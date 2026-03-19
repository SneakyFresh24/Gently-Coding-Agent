<script lang="ts">
  export let critical = 0;
  export let high = 0;
  export let medium = 0;
  export let total = 0;
</script>

<div class="stats-overview">
  <div class="stat-card critical">
    <span class="label">Critical</span>
    <span class="value">{critical}</span>
  </div>
  <div class="stat-card high">
    <span class="label">High</span>
    <span class="value">{high}</span>
  </div>
  <div class="stat-card medium">
    <span class="label">Medium</span>
    <span class="value">{medium}</span>
  </div>
  <div class="stat-card total">
    <span class="label">Total</span>
    <span class="value">{total}</span>
  </div>
</div>

<style>
  .stats-overview {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 24px;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    transition: transform 0.2s ease;
  }

  .stat-card:hover {
    transform: translateY(-2px);
    border-color: var(--vscode-focusBorder);
  }

  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
    margin-bottom: 4px;
  }

  .value {
    font-size: 20px;
    font-weight: 700;
  }

  .critical .value { color: #f14c4c; }
  .high .value { color: #ffa500; }
  .medium .value { color: #cca700; }
  .total .value { color: var(--vscode-foreground); }
</style>
