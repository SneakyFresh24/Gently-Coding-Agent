<script lang="ts">
  import type { Message, PlanCardState } from '../../lib/types';
  import { messaging } from '../../lib/messaging';

  let { message }: { message: Message } = $props();

  const card = $derived((message.planCard || null) as PlanCardState | null);

  function submitApproval(approved: boolean) {
    if (!card) return;
    const approvalRequestId = String(card.pendingApproval?.approvalRequestId || '').trim();
    if (!approvalRequestId) return;
    messaging.send('planApprovalResponse', {
      planId: card.planId,
      approvalRequestId,
      approved,
      source: 'user',
      reason: approved ? 'approved_in_chat_card' : 'rejected_in_chat_card'
    });
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'awaiting_approval': return 'Awaiting Approval';
      case 'approved': return 'Approved';
      case 'rejected': return 'Rejected';
      case 'handed_over': return 'Handed Over';
      default: return status;
    }
  }
</script>

{#if card}
  <div class="plan-card">
    <div class="plan-header">
      <span class="plan-chip">Plan</span>
      <span class="plan-status">{statusLabel(card.status)}</span>
    </div>
    <div class="plan-goal">{card.goal}</div>
    <div class="plan-progress">{card.completedSteps}/{card.totalSteps} steps done</div>
    <div class="plan-steps">
      {#each card.steps as step}
        <div class="plan-step">
          <span class="step-status">{step.status}</span>
          <span class="step-text">{step.description}</span>
        </div>
      {/each}
    </div>
    {#if card.awaitingApproval}
      <div class="plan-actions">
        <button class="btn ghost" onclick={() => submitApproval(false)} disabled={!card.pendingApproval?.approvalRequestId}>Reject</button>
        <button class="btn primary" onclick={() => submitApproval(true)} disabled={!card.pendingApproval?.approvalRequestId}>Approve Plan</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .plan-card {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 8px;
    background: var(--vscode-editor-background);
    padding: 12px;
    display: grid;
    gap: 10px;
  }

  .plan-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .plan-chip {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--vscode-textLink-foreground);
  }

  .plan-status {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .plan-goal {
    font-size: 13px;
    font-weight: 600;
    white-space: pre-wrap;
  }

  .plan-progress {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .plan-steps {
    display: grid;
    gap: 6px;
  }

  .plan-step {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    align-items: start;
    padding: 6px 8px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-sideBar-background);
  }

  .step-status {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .step-text {
    font-size: 12px;
  }

  .plan-actions {
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

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .btn.ghost {
    background: transparent;
    color: var(--vscode-foreground);
  }
</style>
