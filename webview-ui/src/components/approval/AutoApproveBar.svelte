<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AutoApproveModal from './AutoApproveModal.svelte';
  import { extensionStore } from '../../stores/extensionStore';
  import { ACTION_METADATA } from './constants';
  import type { AutoApprovalActions } from '../../lib/types';

  let isModalOpen = $state(false);
  let buttonRef: HTMLButtonElement | null = null;
  let modalStyle = $state('');
  const VIEWPORT_PADDING = 12;

  function getEnabledActionsText(): string {
    const actions = $extensionStore.autoApprovalSettings.actions;
    const allActions = ACTION_METADATA.flatMap(a => {
      const items = [a];
      if (a.subAction) items.push(a.subAction);
      return items;
    });
    const enabled = allActions
      .filter(a => actions[a.id as keyof AutoApprovalActions])
      .map(a => a.shortName);
    return enabled.length > 0 ? enabled.join(', ') : 'None';
  }

  async function toggleModal() {
    isModalOpen = !isModalOpen;
    if (isModalOpen) {
      await tick();
      updateModalPosition();
    }
  }

  function updateModalPosition() {
    if (!buttonRef) return;

    const triggerRect = buttonRef.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(360, viewportWidth - VIEWPORT_PADDING * 2);
    const preferredHeight = 430;

    const spaceAbove = triggerRect.top - VIEWPORT_PADDING - 8;
    const spaceBelow = viewportHeight - triggerRect.bottom - VIEWPORT_PADDING - 8;
    const openUpward = spaceAbove >= Math.min(preferredHeight, 320) || spaceAbove > spaceBelow;

    const top = openUpward
      ? Math.max(VIEWPORT_PADDING, triggerRect.top - Math.min(preferredHeight, spaceAbove))
      : Math.min(triggerRect.bottom + 8, viewportHeight - preferredHeight - VIEWPORT_PADDING);

    const preferredLeft = triggerRect.left;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(preferredLeft, viewportWidth - panelWidth - VIEWPORT_PADDING)
    );

    const maxHeight = Math.max(220, openUpward ? spaceAbove : spaceBelow);
    modalStyle = `top: ${top}px; left: ${left}px; width: ${panelWidth}px; max-height: ${maxHeight}px;`;
  }

  onMount(() => {
    window.addEventListener('resize', updateModalPosition);
    window.addEventListener('scroll', updateModalPosition, true);
    return () => {
      window.removeEventListener('resize', updateModalPosition);
      window.removeEventListener('scroll', updateModalPosition, true);
    };
  });
</script>

<div class="auto-approve-bar">
  <button
    bind:this={buttonRef}
    class="bar-button"
    onclick={toggleModal}
    aria-expanded={isModalOpen}
  >
    <span class="label">Auto-approve:</span>
    <span class="value truncate">{getEnabledActionsText()}</span>
    <span class="chevron">
      <i class="codicon {isModalOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}"></i>
    </span>
  </button>

</div>

<AutoApproveModal
  isOpen={isModalOpen}
  style={modalStyle}
/>

<style>
  .auto-approve-bar {
    padding: 0;
  }

  .bar-button {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--vscode-foreground);
    font-size: var(--font-size-xs);
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    padding: 2px 8px;
    transition: all 0.2s ease;
    opacity: 0.8;
  }

  .bar-button:hover {
    background: var(--vscode-toolbar-hoverBackground);
    border-color: var(--vscode-widget-border);
    opacity: 1;
  }

  .label {
    opacity: 0.9;
    flex-shrink: 0;
  }

  .value {
    opacity: 0.6;
    flex: 1;
    min-width: 0;
  }

  .chevron {
    opacity: 0.5;
    font-size: var(--font-size-xxs);
    flex-shrink: 0;
  }
</style>
