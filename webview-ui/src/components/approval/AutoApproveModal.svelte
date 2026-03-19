<script lang="ts">
  import AutoApproveItem from './AutoApproveItem.svelte';
  import { extensionStore } from '../../stores/extensionStore';
  import { ACTION_METADATA } from './constants';
  import type { AutoApprovalActions } from '../../lib/types';

  let {
    isOpen = false,
    onClose = () => {},
  }: {
    isOpen?: boolean;
    onClose?: () => void;
  } = $props();

  let modalRef: HTMLDivElement | undefined = $state();

  function handleToggle(actionId: string, enabled: boolean) {
    const currentActions = $extensionStore.autoApprovalSettings.actions;
    extensionStore.updateAutoApprovalSettings({
      actions: {
        ...currentActions,
        [actionId]: enabled,
      } as AutoApprovalActions,
    });
  }

  function handleClickOutside(e: MouseEvent) {
    if (modalRef && !modalRef.contains(e.target as Node)) {
      onClose();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if isOpen}
  <div class="modal-wrapper" onclick={handleClickOutside}>
    <div class="modal" bind:this={modalRef} onclick={(e) => e.stopPropagation()}>
      <p class="hint">
        Let Gently take these actions without asking for approval.
      </p>

      <div class="items">
        {#each ACTION_METADATA as action (action.id)}
          <AutoApproveItem
            {action}
            checked={$extensionStore.autoApprovalSettings.actions[action.id as keyof AutoApprovalActions] ?? false}
            onToggle={(enabled) => handleToggle(action.id, enabled)}
          />
          {#if action.subAction}
            <div class="sub-item">
              <AutoApproveItem
                action={action.subAction}
                checked={$extensionStore.autoApprovalSettings.actions[action.subAction.id as keyof AutoApprovalActions] ?? false}
                onToggle={(enabled) => handleToggle(action.subAction!.id, enabled)}
              />
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-wrapper {
    position: fixed;
    inset: 0;
    z-index: var(--z-dropdown);
  }

  .modal {
    position: absolute;
    bottom: 60px;
    left: var(--space-lg);
    right: var(--space-lg);
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
    max-height: 300px;
    overflow-y: auto;
    box-shadow: var(--shadow-lg);
  }

  .hint {
    font-size: var(--font-size-xs);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-lg);
    line-height: var(--line-height-normal);
  }

  .items {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .sub-item {
    padding-left: var(--space-2xl);
  }
</style>
