<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let {
    isOpen = false,
    onClose = () => {},
    title = '',
    children,
  }: {
    isOpen?: boolean;
    onClose?: () => void;
    title?: string;
    children?: any;
  } = $props();

  let modalRef: HTMLDivElement | undefined = $state();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if isOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div class="modal" bind:this={modalRef} role="dialog" aria-modal="true" aria-label={title}>
      {#if title}
        <div class="modal-header">
          <h3 class="modal-title">{title}</h3>
          <button class="modal-close" onclick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>
      {/if}
      <div class="modal-body">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
  }

  .modal {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    min-width: 300px;
    max-width: 90vw;
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-lg) var(--space-xl);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .modal-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .modal-close {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    font-size: var(--font-size-lg);
    padding: var(--space-xs);
    opacity: 0.6;
    line-height: 1;
  }

  .modal-close:hover {
    opacity: 1;
  }

  .modal-body {
    padding: var(--space-xl);
    overflow-y: auto;
  }
</style>
