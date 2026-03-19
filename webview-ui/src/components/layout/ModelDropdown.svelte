<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModelInfo } from '../../lib/types';
  
  export let selectedModel = '';
  export let models: ModelInfo[] = [];
  
  let isOpen = false;

  $: selectedModelName = models.find(m => m.id === selectedModel)?.name || selectedModel || 'Select Model';

  function selectModel(modelId: string) {
    selectedModel = modelId;
    isOpen = false;
    // Notify app of change
    window.postMessage({ type: 'modelChanged', model: modelId }, '*');
  }

  function toggleDropdown() {
    isOpen = !isOpen;
  }

  // Close when clicking outside
  function handleOutsideClick(e: MouseEvent) {
    if (isOpen) {
      const target = e.target as HTMLElement;
      if (!target.closest('.model-selector')) {
        isOpen = false;
      }
    }
  }

  onMount(() => {
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  });
</script>

<div class="model-selector">
  <button class="selector-btn" on:click={toggleDropdown}>
    <span class="model-name">{selectedModelName}</span>
    <span class="chevron">▾</span>
  </button>

  {#if isOpen}
    <div class="dropdown">
      {#each models as model (model.id)}
        <button 
          class="model-item" 
          class:active={model.id === selectedModel}
          on:click={() => selectModel(model.id)}
        >
          <div class="model-info">
            <span class="model-label">{model.name}</span>
            <span class="model-context">{Math.round(model.context_length / 1000)}k</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .model-selector {
    position: relative;
    display: inline-block;
  }

  .selector-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: var(--font-size-xs);
    cursor: pointer;
    transition: all 0.2s ease;
    opacity: 0.8;
  }

  .selector-btn:hover {
    background: var(--vscode-toolbar-hoverBackground);
    border-color: var(--vscode-widget-border);
    opacity: 1;
  }

  .model-name {
    max-width: 150px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 6px;
    box-shadow: var(--shadow-lg);
    z-index: 1000;
    min-width: 220px;
    max-height: 300px;
    overflow-y: auto;
  }

  .model-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    text-align: left;
    background: transparent;
    color: var(--vscode-dropdown-foreground);
    border: none;
    font-size: 12px;
    cursor: pointer;
  }

  .model-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    gap: 8px;
  }

  .model-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .model-context {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    padding: 1px 4px;
    border-radius: 3px;
    opacity: 0.8;
  }

  .model-item.active .model-context {
    background: var(--vscode-list-activeSelectionForeground);
    color: var(--vscode-list-activeSelectionBackground);
    opacity: 1;
  }
</style>
