<script lang="ts">
  import { extensionSync } from "../../lib/extensionSync";
  import { fade, slide } from "svelte/transition";
  import Icon from "../ui/Icon.svelte";
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  export let approvalId: string;
  export let toolName: string;
  export let params: any;

  let status: "pending" | "approved" | "rejected" = "pending";

  function handleApprove() {
    status = "approved";
    extensionSync.send("toolApprovalResponse", {
      approvalId,
      approved: true,
    });
    setTimeout(() => dispatch('close'), 600);
  }

  function handleReject() {
    status = "rejected";
    extensionSync.send("toolApprovalResponse", {
      approvalId,
      approved: false,
    });
    setTimeout(() => dispatch('close'), 600);
  }
</script>

<div
  class="tool-approval"
  class:approved={status === "approved"}
  class:rejected={status === "rejected"}
  transition:fade
>
  <div class="approval-header">
    <div class="tool-badge">
      <Icon name="Wrench" size={12} />
      <span>{toolName}</span>
    </div>
    <div class="header-info">
        <span>Tool Execution Approval Required</span>
    </div>
  </div>

  <div class="approval-body">
    <div class="params-container">
      <pre><code>{JSON.stringify(params, null, 2)}</code></pre>
    </div>
    <div class="warning-note" transition:slide>
        <Icon name="AlertTriangle" size={12} />
        <span>This tool requires manual confirmation as it may modify system state or access external resources.</span>
    </div>
  </div>

  <div class="approval-actions">
    {#if status === "pending"}
      <button class="action-btn reject" on:click={handleReject} title="Deny">
        <Icon name="X" size={16} />
        <span>Deny</span>
      </button>
      <button
        class="action-btn approve"
        on:click={handleApprove}
        title="Approve"
      >
        <Icon name="Check" size={16} />
        <span>Approve</span>
      </button>
    {:else}
      <div class="status-result {status}">
        <Icon name={status === "approved" ? "Check" : "X"} size={14} />
        <span>{status === "approved" ? "Approved" : "Rejected"}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .tool-approval {
    background: rgba(30,30,45, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 1rem;
    padding: 1.25rem;
    margin: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(96, 165, 250, 0.1);
    position: relative;
    z-index: 10000;
  }

  .approval-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 0.75rem;
  }

  .tool-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.1);
    border: 1px solid rgba(96, 165, 250, 0.2);
  }

  .header-info {
    font-size: 11px;
    font-weight: 500;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .params-container {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 1rem;
    max-height: 200px;
    overflow-y: auto;
  }

  .params-container code {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: #ddd;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .warning-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 0.75rem;
    font-size: 11px;
    padding: 8px 12px;
    border-radius: 6px;
    background: rgba(245, 158, 11, 0.05);
    border: 1px solid rgba(245, 158, 11, 0.2);
    color: #f59e0b;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: #fff;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .action-btn.reject:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
    color: #f87171;
    transform: translateY(-1px);
  }

  .action-btn.approve {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(22, 163, 74, 0.2));
    border-color: rgba(34, 197, 94, 0.4);
    color: #4ade80;
  }

  .action-btn.approve:hover {
    background: linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(22, 163, 74, 0.3));
    border-color: rgba(34, 197, 94, 0.6);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(34, 197, 94, 0.2);
  }

  .status-result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 13px;
    font-weight: 700;
  }

  .status-result.approved {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .status-result.rejected {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .tool-approval.approved {
    border-color: rgba(34, 197, 94, 0.4);
    box-shadow: 0 0 30px rgba(34, 197, 94, 0.1);
  }
  
  .tool-approval.rejected {
    border-color: rgba(239, 68, 68, 0.4);
    box-shadow: 0 0 30px rgba(239, 68, 68, 0.1);
  }
</style>
