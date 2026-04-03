<script lang="ts">
  import type { Message, ToolApprovalCardState } from '../../lib/types';
  import { messaging } from '../../lib/messaging';
  import { onDestroy } from 'svelte';

  let { message }: { message: Message } = $props();

  const card = $derived((message.approvalCard || null) as ToolApprovalCardState | null);
  let now = $state(Date.now());
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let localTimeoutReportedForApprovalId = $state<string | null>(null);

  const remainingMs = $derived(
    card && card.status === 'pending' && Number.isFinite(Number(card.expiresAt || 0)) && Number(card.expiresAt || 0) > 0
      ? Math.max(0, Number(card.expiresAt || 0) - now)
      : 0
  );
  const locallyTimedOut = $derived(Boolean(card && card.status === 'pending' && remainingMs <= 0));
  const actionDisabled = $derived(Boolean(!card || card.status !== 'pending' || locallyTimedOut));

  $effect(() => {
    if (!card || card.status !== 'pending' || !locallyTimedOut) return;
    if (localTimeoutReportedForApprovalId === card.approvalId) return;
    localTimeoutReportedForApprovalId = card.approvalId;
    messaging.send('toolApprovalLocalTimeout', {
      approvalId: card.approvalId,
      toolName: card.toolName,
      timestamp: Date.now(),
      expiresAt: card.expiresAt
    });
  });

  $effect(() => {
    if (!card || card.status !== 'pending') {
      if (timerHandle) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
      return;
    }

    now = Date.now();
    timerHandle = setInterval(() => {
      now = Date.now();
    }, 1000);

    return () => {
      if (timerHandle) {
        clearInterval(timerHandle);
        timerHandle = null;
      }
    };
  });

  onDestroy(() => {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  });

  function respond(approved: boolean, alwaysApprove = false) {
    if (!card || card.status !== 'pending' || locallyTimedOut) return;
    messaging.send('toolApprovalResponse', {
      approvalId: card.approvalId,
      approved,
      alwaysApprove
    });
  }

  function prettyParams(params: any): string {
    try {
      return JSON.stringify(params ?? {}, null, 2);
    } catch {
      return String(params ?? '');
    }
  }

  function formatCountdown(ms: number): string {
    const safeMs = Math.max(0, Math.floor(ms));
    const totalSeconds = Math.floor(safeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function displayStatus(): string {
    if (!card) return 'pending';
    if (card.status === 'pending' && locallyTimedOut) return 'timeout';
    return card.status;
  }
</script>

{#if card}
  <div class="approval-card" data-status={displayStatus()}>
    <div class="approval-header">
      <span class="approval-chip">Approval</span>
      <span class="approval-status">{displayStatus()}</span>
    </div>
    <div class="approval-tool">{card.toolName}</div>
    {#if card.status === 'pending'}
      <div class="approval-countdown" data-expired={locallyTimedOut ? 'true' : 'false'}>
        {#if locallyTimedOut}
          Timeout reached. Waiting for final resolution...
        {:else}
          Expires in {formatCountdown(remainingMs)}
        {/if}
      </div>
    {/if}
    <pre class="approval-params">{prettyParams(card.params)}</pre>

    {#if card.status === 'pending'}
      <div class="approval-actions">
        <button class="btn ghost" disabled={actionDisabled} onclick={() => respond(false)}>Deny</button>
        <button class="btn secondary" disabled={actionDisabled} onclick={() => respond(true, true)}>Always</button>
        <button class="btn primary" disabled={actionDisabled} onclick={() => respond(true)}>Approve</button>
      </div>
    {:else if card.reason}
      <div class="approval-reason">{card.reason}</div>
    {/if}
  </div>
{/if}

<style>
  .approval-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-editor-background);
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  .approval-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .approval-chip {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--vscode-textLink-foreground);
  }

  .approval-status {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
  }

  .approval-tool {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    font-weight: 600;
  }

  .approval-countdown {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .approval-countdown[data-expired='true'] {
    color: var(--vscode-errorForeground);
  }

  .approval-params {
    margin: 0;
    padding: 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-textCodeBlock-background);
    font-size: 11px;
    max-height: 180px;
    overflow: auto;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }

  .btn.ghost {
    background: transparent;
    color: var(--vscode-foreground);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .approval-reason {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
</style>
