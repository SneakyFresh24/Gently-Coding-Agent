<script lang="ts">
  import { extensionStore } from '../../stores/extensionStore';
  import { messaging } from '../../lib/messaging';
  import Icon from '../ui/Icon.svelte';

  let isOpen = $derived(!!$extensionStore.pendingApproval);
  let pending = $derived($extensionStore.pendingApproval);

  function handleResponse(approved: boolean, alwaysApprove: boolean = false) {
    if (!pending) return;

    messaging.send('toolApprovalResponse', {
      approvalId: pending.approvalId,
      approved,
      alwaysApprove
    });

    extensionStore.setPendingApproval(null);
  }

  function formatParams(params: any): string {
    if (!params) return '';
    try {
      return JSON.stringify(params, null, 2);
    } catch (e) {
      return String(params);
    }
  }
</script>

{#if isOpen && pending}
  <div class="modal-backdrop">
    <div class="modal-content">
      <header class="modal-header">
        <Icon name="shield" size={20} />
        <h3>Tool Approval Required</h3>
      </header>
      
      <div class="modal-body">
        <div class="info-row">
          <span class="label">Tool:</span>
          <span class="value code">{pending.toolName}</span>
        </div>
        
        <div class="params-container">
          <span class="label">Parameters:</span>
          <pre class="params-code"><code>{formatParams(pending.params)}</code></pre>
        </div>

        <div class="warning-box">
          <Icon name="warning" size={16} />
          <p>This action requires your manual approval before proceeding.</p>
        </div>
      </div>

      <footer class="modal-footer">
        <div class="secondary-actions">
          <button class="btn ghost danger" onclick={() => handleResponse(false)}>
            Deny
          </button>
        </div>
        <div class="primary-actions">
          <button class="btn secondary" onclick={() => handleResponse(true, true)}>
            Always Approve
          </button>
          <button class="btn primary" onclick={() => handleResponse(true, false)}>
            Approve
          </button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
  }

  .modal-content {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    width: 100%;
    max-width: 500px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--vscode-panel-border);
    color: var(--vscode-notifications-foreground);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .modal-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .info-row {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }

  .label {
    font-size: 12px;
    opacity: 0.6;
    width: 80px;
    flex-shrink: 0;
  }

  .value.code {
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 12px;
  }

  .params-container {
    margin-bottom: 20px;
  }

  .params-code {
    margin-top: 8px;
    background: var(--vscode-textCodeBlock-background);
    padding: 12px;
    border-radius: 6px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 11px;
    border: 1px solid var(--vscode-panel-border);
  }

  .warning-box {
    display: flex;
    gap: 12px;
    background: var(--vscode-notificationsWarning-background);
    color: var(--vscode-notificationsWarning-foreground);
    padding: 12px;
    border-radius: 6px;
    border: 1px solid var(--vscode-notificationsWarning-border);
    font-size: 12px;
    line-height: 1.4;
  }

  .warning-box p {
    margin: 0;
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    padding: 16px 20px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    border-radius: 0 0 8px 8px;
  }

  .primary-actions, .secondary-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 16px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    border: none;
    font-weight: 500;
  }

  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .btn.primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .btn.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .btn.ghost {
    background: transparent;
    color: var(--vscode-foreground);
    opacity: 0.7;
  }

  .btn.ghost:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground);
  }

  .btn.danger {
    color: var(--vscode-errorForeground);
  }
</style>
