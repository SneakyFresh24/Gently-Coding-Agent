<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ModelInfo } from '../../lib/types';
  import { messaging } from '../../lib/messaging';
  
  export let selectedModel = '';
  export let models: ModelInfo[] = [];
  
  let isOpen = false;
  let searchTerm = '';
  let selectorRef: HTMLDivElement | null = null;
  let dropdownRef: HTMLDivElement | null = null;
  let dropdownStyle = '';
  const VIEWPORT_PADDING = 12;


  $: selectedModelName = models.find(m => m.id === selectedModel)?.name || selectedModel || 'Select Model';
  $: filteredModels = searchTerm 
    ? models.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()) || m.id.toLowerCase().includes(searchTerm.toLowerCase()))
    : models;


  function selectModel(modelId: string) {
    selectedModel = modelId;
    isOpen = false;
    searchTerm = '';
    messaging.send('modelChanged', { model: modelId });
  }

  async function toggleDropdown() {
    isOpen = !isOpen;
    if (isOpen) {
      await tick();
      updateDropdownPosition();
      requestAnimationFrame(() => dropdownRef?.querySelector('input')?.focus());
    }
  }

  function handleSelectorKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void toggleDropdown();
    }
    if (e.key === 'Escape') {
      isOpen = false;
    }
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

  function updateDropdownPosition() {
    if (!selectorRef || !dropdownRef) return;

    const triggerRect = selectorRef.getBoundingClientRect();
    const dropdownRect = dropdownRef.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const spaceAbove = triggerRect.top - VIEWPORT_PADDING - 8;
    const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_PADDING - 8;
    const openUpward = spaceAbove >= Math.min(dropdownRect.height, 320) || spaceAbove > spaceBelow;
    const top = openUpward
      ? Math.max(VIEWPORT_PADDING, triggerRect.top - Math.min(dropdownRect.height, spaceAbove))
      : Math.min(triggerRect.bottom + 8, viewportHeight - dropdownRect.height - VIEWPORT_PADDING);

    const preferredLeft = triggerRect.right - dropdownRect.width;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(preferredLeft, viewportWidth - dropdownRect.width - VIEWPORT_PADDING)
    );

    const maxHeight = Math.max(180, openUpward ? spaceAbove : spaceBelow);
    dropdownStyle = `top: ${Math.max(VIEWPORT_PADDING, top)}px; left: ${left}px; max-height: ${maxHeight}px;`;
  }

  onMount(() => {
    window.addEventListener('click', handleOutsideClick);
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('click', handleOutsideClick);
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  });
</script>

<div class="model-selector" bind:this={selectorRef}>
  <button
    class="selector-btn"
    on:click={toggleDropdown}
    on:keydown={handleSelectorKeydown}
    aria-label="Select model"
    aria-expanded={isOpen}
    aria-haspopup="listbox"
  >
    <span class="model-name">{selectedModelName}</span>
    <span class="chevron">
      <i class="codicon {isOpen ? 'codicon-chevron-up' : 'codicon-chevron-down'}"></i>
    </span>
  </button>


  {#if isOpen}
    <div class="dropdown" bind:this={dropdownRef} style={dropdownStyle}>
      <div class="search-container">
        <input 
          type="text" 
          placeholder="Search models..." 
          bind:value={searchTerm}
          on:click|stopPropagation
          aria-label="Search models"
        />
      </div>
      <div class="model-list" role="listbox" aria-label="Model options">
        {#each filteredModels as model (model.id)}
          <button 
            class="model-item" 
            class:active={model.id === selectedModel}
            on:click={() => selectModel(model.id)}
            aria-label={`Select model ${model.name}`}
          >
            <div class="model-info">
              <span class="model-label">{model.name}</span>
              <span class="model-context">{Math.round(model.context_length / 1000)}k</span>
            </div>
          </button>
        {/each}
        {#if filteredModels.length === 0}
          <div class="no-results">No models found</div>
        {/if}
      </div>
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
    position: fixed;
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 6px;
    box-shadow: var(--shadow-lg);
    z-index: 4000;
    width: min(360px, calc(100vw - 24px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .search-container {
    padding: 8px;
    border-bottom: 1px solid var(--vscode-dropdown-border);
    background: var(--vscode-input-background);
  }

  .search-container input {
    width: 100%;
    padding: 4px 8px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    font-size: 11px;
  }

  .model-list {
    flex: 1;
    overflow-y: auto;
  }

  .no-results {
    padding: 12px;
    text-align: center;
    font-size: 11px;
    opacity: 0.5;
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
