<script lang="ts">
  import { onMount } from 'svelte';
  
  export let selectedModel = '';
  export let models: string[] = [];
  
  let isOpen = false;

  function selectModel(model: string) {
    selectedModel = model;
    isOpen = false;
    // Notify app of change
    window.postMessage({ type: 'modelChanged', model }, '*');
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
    <span class="model-name">{selectedModel || 'Select Model'}</span>
    <span class="chevron">▾</span>
  </button>

  {#if isOpen}
    <div class="dropdown">
      {#each models as model}
        <button 
          class="model-item" 
          class:active={model === selectedModel}
          on:click={() => selectModel(model)}
        >
          {model}
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
    padding: 4px 10px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .selector-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
    border-color: var(--vscode-focusBorder);
  }

  .model-name {
    max-width: 120px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 1000;
    min-width: 180px;
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

  .model-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .model-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
</style>
