<script lang="ts">
  import { settingsStore } from '../../stores/settingsStore';
  import { extensionStore } from '../../stores/extensionStore';

  const models = $derived($settingsStore.availableModels);
  const currentModel = $derived($extensionStore.selectedModel);
  const isLoading = $derived($settingsStore.isLoadingModels);

  function handleChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    extensionStore.setSelectedModel(value);
  }

  function handleRefresh() {
    settingsStore.fetchModels();
  }
</script>

<div class="model-selector">
  <div class="selector-row">
    <select
      class="model-select"
      value={currentModel}
      onchange={handleChange}
      disabled={isLoading}
    >
      {#if models.length === 0}
        <option value={currentModel}>{currentModel || 'No models loaded'}</option>
      {:else}
        {#each models as model (model.id)}
          <option value={model.id}>
            {model.name} ({Math.round(model.context_length / 1000)}k)
          </option>
        {/each}
      {/if}
    </select>

    <button
      class="refresh-btn"
      onclick={handleRefresh}
      disabled={isLoading}
      title="Refresh models"
    >
      {isLoading ? '⏳' : '🔄'}
    </button>
  </div>

  {#if currentModel}
    <p class="current-model">Current: <code>{currentModel}</code></p>
  {/if}
</div>

<style>
  .model-selector {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .selector-row {
    display: flex;
    gap: var(--space-sm);
  }

  .model-select {
    flex: 1;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, var(--vscode-panel-border)));
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }

  .model-select:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
  }

  .model-select:disabled {
    opacity: 0.6;
  }

  .refresh-btn {
    background: none;
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    padding: var(--space-sm) var(--space-md);
    font-size: var(--font-size-sm);
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.12));
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .current-model {
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
  }

  .current-model code {
    font-size: var(--font-size-xxs);
  }
</style>
