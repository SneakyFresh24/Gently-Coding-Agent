<script lang="ts">
  import AutoApproveItem from './AutoApproveItem.svelte';
  import { extensionStore } from '../../stores/extensionStore';
  import type { AutoApprovalActions } from '../../lib/types';
  import Icon from '../ui/Icon.svelte';

  let {
    isOpen = $bindable(false),
    style = '',
  }: {
    isOpen?: boolean;
    style?: string;
  } = $props();

  let modalRef: HTMLDivElement | undefined = $state();

  function updateSettings(
    newSettings: Partial<AutoApprovalActions> & { enableNotifications?: boolean },
  ) {
    extensionStore.updateAutoApprovalSettings({
      ...$extensionStore.autoApprovalSettings,
      ...newSettings,
      actions: {
        ...$extensionStore.autoApprovalSettings.actions,
        ...(newSettings as any),
      } as AutoApprovalActions,
    });
  }

  function handleClickOutside(e: MouseEvent) {
    if (modalRef && !modalRef.contains(e.target as Node)) {
      isOpen = false;
    }
  }
</script>

{#if isOpen}
  <div class="modal-wrapper" onclick={handleClickOutside} role="button" tabindex="0" onkeydown={(e) => e.key === 'Escape' && (isOpen = false)}>
    <div class="modal" bind:this={modalRef} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1" {style}>
      <header class="modal-header">
        <div class="title-with-icon">
          <Icon name="shield" size={18} />
          <h3>Auto-Approval</h3>
        </div>
        <button class="close-btn" onclick={() => (isOpen = false)} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div class="modal-body">
        <div class="section-intro">
          <p>Configure which actions Gently can perform automatically.</p>
        </div>

        <div class="settings-list">
          <AutoApproveItem
            label="Read Files"
            description="Allows reading files in your workspace."
            enabled={$extensionStore.autoApprovalSettings.actions.readFiles}
            onToggle={(val) => updateSettings({ readFiles: val } as any)}
          />
          <AutoApproveItem
            label="Edit Files"
            description="Allows modifying project files (including .gently/memory-bank)."
            enabled={$extensionStore.autoApprovalSettings.actions.editFiles}
            onToggle={(val) => updateSettings({ editFiles: val } as any)}
          />
          <AutoApproveItem
            label="Safe Commands"
            description="Allows executing safe terminal commands (e.g. ls, git status)."
            enabled={$extensionStore.autoApprovalSettings.actions.executeSafeCommands}
            onToggle={(val) => updateSettings({ executeSafeCommands: val } as any)}
          />
          <AutoApproveItem
            label="All Commands"
            description="Allows executing ANY terminal command."
            enabled={$extensionStore.autoApprovalSettings.actions.executeAllCommands}
            onToggle={(val) => updateSettings({ executeAllCommands: val } as any)}
            risky
          />
        </div>

        <div class="footer-options">
          <div class="option-row">
            <input 
              type="checkbox" 
              id="enableNotifications" 
              checked={$extensionStore.autoApprovalSettings.enableNotifications}
              onchange={(e) => updateSettings({ enableNotifications: e.currentTarget.checked })}
            />
            <label for="enableNotifications">Enable notifications</label>
          </div>
        </div>
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
    position: fixed;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: slideUp 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
  }

  @keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    background: var(--vscode-sideBarSectionHeader-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .title-with-icon {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--vscode-sideBarSectionHeader-foreground);
    opacity: 0.9;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .close-btn {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--vscode-foreground);
    opacity: 0.6;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .modal-body {
    padding: 12px;
    overflow-y: auto;
  }

  .section-intro {
    font-size: 11px;
    line-height: 1.4;
    opacity: 0.6;
    margin-bottom: 16px;
    padding: 0 4px;
  }

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .footer-options {
    padding-top: 12px;
    border-top: 1px solid var(--vscode-panel-border);
  }

  .option-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .option-row label {
    cursor: pointer;
    opacity: 0.7;
  }

  .option-row input:checked + label {
    opacity: 1;
  }
</style>
