<script lang="ts">
  import { extensionStore } from '../../stores/extensionStore';

  export let mode: 'architect' | 'code' | 'ask' | 'agent' | 'debug' = 'architect';

  $: normalizedMode = mode === 'code' ? 'code' : 'architect';
  $: nextMode = normalizedMode === 'code' ? 'architect' : 'code';
  $: label = normalizedMode === 'code' ? 'Code' : 'Architect';
  $: title = normalizedMode === 'code'
    ? 'Switch to Architect mode'
    : 'Switch to Code mode';

  function handleToggle() {
    extensionStore.setMode(nextMode);
  }
</script>

<button class="mode-toggle" on:click={handleToggle} title={title} type="button">
  <span class="dot" aria-hidden="true"></span>
  <span>{label}</span>
</button>

<style>
  .mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--vscode-dropdown-border);
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }

  .mode-toggle:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--vscode-charts-green);
  }
</style>
