<script lang="ts">
  import type { Message } from '../../lib/types';
  import Button from '../ui/Button.svelte';
  import { messaging } from '../../lib/messaging';

  let {
    message,
  }: {
    message: Message;
  } = $props();

  const approval = $derived(message.commandApproval);
  const isPending = $derived(approval?.status === 'pending');

  function respond(response: 'accept' | 'accept_always' | 'deny') {
    if (!approval) return;
    messaging.send('commandApprovalResponse', {
      commandId: approval.commandId,
      response,
    });
  }

  function getSafetyColor(level?: string): string {
    switch (level) {
      case 'safe': return 'var(--vscode-gitDecoration-addedResourceForeground, #73c991)';
      case 'moderate': return 'var(--vscode-editorWarning-foreground, #cca700)';
      case 'risky': return 'var(--vscode-errorForeground, #f48771)';
      default: return 'var(--vscode-descriptionForeground)';
    }
  }
</script>

<div class="command-message">
  <div class="command-header">
    <span class="command-icon">⚡</span>
    <span class="command-label">Command Approval</span>
    {#if approval?.safetyLevel}
      <span class="safety-badge" style="color: {getSafetyColor(approval.safetyLevel)}">
        {approval.safetyLevel}
      </span>
    {/if}
  </div>

  {#if approval}
    <div class="command-block">
      <code>{approval.command}</code>
    </div>

    {#if approval.cwd}
      <div class="command-cwd">
        📁 {approval.cwd}
      </div>
    {/if}

    {#if approval.reason}
      <div class="command-reason">{approval.reason}</div>
    {/if}

    {#if isPending}
      <div class="command-actions">
        <Button variant="primary" size="sm" onclick={() => respond('accept')}>
          Accept
        </Button>
        <Button variant="secondary" size="sm" onclick={() => respond('accept_always')}>
          Accept Always
        </Button>
        <Button variant="danger" size="sm" onclick={() => respond('deny')}>
          Deny
        </Button>
      </div>
    {:else}
      <div class="command-status">
        {approval.status === 'approved' ? '✅ Approved' : '❌ Denied'}
      </div>
    {/if}
  {/if}
</div>

<style>
  .command-message {
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
    background: var(--vscode-editor-background);
  }

  .command-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-md);
  }

  .command-icon {
    font-size: var(--font-size-lg);
  }

  .command-label {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .safety-badge {
    font-size: var(--font-size-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: auto;
    font-weight: 600;
  }

  .command-block {
    background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
    padding: var(--space-md) var(--space-lg);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-md);
    overflow-x: auto;
  }

  .command-block code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--font-size-sm);
    background: transparent;
    padding: 0;
  }

  .command-cwd {
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-sm);
  }

  .command-reason {
    font-size: var(--font-size-xs);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-lg);
    font-style: italic;
  }

  .command-actions {
    display: flex;
    gap: var(--space-sm);
  }

  .command-status {
    font-size: var(--font-size-sm);
    font-weight: 600;
    padding-top: var(--space-sm);
  }
</style>
