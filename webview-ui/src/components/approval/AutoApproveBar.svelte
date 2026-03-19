<script lang="ts">
  import AutoApproveModal from './AutoApproveModal.svelte';
  import { extensionStore } from '../../stores/extensionStore';
  import { ACTION_METADATA } from './constants';
  import type { AutoApprovalActions } from '../../lib/types';

  let isModalOpen = $state(false);

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
</script>

<div class="auto-approve-bar">
  <button
    class="bar-button"
    onclick={() => isModalOpen = !isModalOpen}
    aria-expanded={isModalOpen}
  >
    <span class="label">Auto-approve:</span>
    <span class="value truncate">{getEnabledActionsText()}</span>
    <span class="chevron">{isModalOpen ? '▾' : '▸'}</span>
  </button>
</div>

<AutoApproveModal
  isOpen={isModalOpen}
  onClose={() => isModalOpen = false}
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
