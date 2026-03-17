<script lang="ts">
  import { extensionSync } from "../../lib/extensionSync";
  import { chatStore } from "../../stores/chatStore";
  import { fade, slide } from "svelte/transition";
  import Icon from "../ui/Icon.svelte";

  export let commandId: string;
  export let command: string;
  export let cwd: string;
  export let reason: string;
  export let safetyLevel: "safe" | "moderate" | "risky";
  export let status: "pending" | "approved" | "rejected" = "pending";

  function handleApprove() {
    chatStore.updateCommandApprovalStatus(commandId, "approved");
    extensionSync.send("commandApprovalResponse", {
      commandId,
      response: "accept",
    });
  }

  function handleReject() {
    chatStore.updateCommandApprovalStatus(commandId, "rejected");
    extensionSync.send("commandApprovalResponse", {
      commandId,
      response: "deny",
    });
  }

  function handleAcceptAlways() {
    chatStore.updateCommandApprovalStatus(commandId, "approved");
    extensionSync.send("commandApprovalResponse", {
      commandId,
      response: "accept_always",
    });
  }

  const safetyMeta = {
    safe: { icon: "CheckCircle2", label: "Safe", class: "safety-safe" },
    moderate: {
      icon: "AlertTriangle",
      label: "Moderate",
      class: "safety-moderate",
    },
    risky: { icon: "AlertOctagon", label: "Risky", class: "safety-risky" },
  };

  $: meta = safetyMeta[safetyLevel] || safetyMeta.moderate;
</script>

<div
  class="command-approval"
  class:approved={status === "approved"}
  class:rejected={status === "rejected"}
  transition:fade
>
  <div class="approval-header">
    <div class="safety-badge {meta.class}">
      <Icon name={meta.icon} size={12} />
      <span>{meta.label}</span>
    </div>
    <div class="cwd-path" title={cwd}>
      <Icon name="Folder" size={12} />
      <span>{cwd.split(/[\\/]/).pop()}</span>
    </div>
  </div>

  <div class="approval-body">
    <div class="command-container">
      <code>{command}</code>
    </div>
    {#if reason}
      <div class="reason-note" transition:slide>
        <Icon name="Info" size={12} />
        <span>{reason}</span>
      </div>
    {/if}
  </div>

  <div class="approval-actions">
    {#if status === "pending"}
      <button class="action-btn reject" on:click={handleReject} title="Reject">
        <Icon name="X" size={16} />
      </button>
      <button
        class="action-btn accept-always"
        on:click={handleAcceptAlways}
        title="Accept Always"
      >
        <Icon name="ShieldCheck" size={16} />
      </button>
      <button
        class="action-btn approve"
        on:click={handleApprove}
        title="Execute"
      >
        <Icon name="Play" size={16} />
      </button>
    {:else}
      <div class="status-result {status}">
        <Icon name={status === "approved" ? "Check" : "X"} size={14} />
        <span>{status === "approved" ? "Executed" : "Rejected"}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .command-approval {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 0.75rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .approval-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .safety-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .safety-safe {
    color: #22c55e;
    border-color: rgba(34, 197, 94, 0.3);
  }
  .safety-moderate {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.3);
  }
  .safety-risky {
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
  }

  .cwd-path {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    opacity: 0.5;
    font-family: var(--vscode-editor-font-family);
  }

  .command-container {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 0.75rem;
    overflow-x: auto;
  }

  .command-container code {
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    color: var(--vscode-editor-foreground);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .reason-note {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 0.5rem;
    font-size: 11px;
    opacity: 0.7;
    font-style: italic;
    color: #60a5fa;
  }

  .approval-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .action-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .action-btn.reject:hover {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #f87171;
  }

  .action-btn.approve {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.3);
    color: #4ade80;
  }

  .action-btn.approve:hover {
    background: rgba(34, 197, 94, 0.25);
    border-color: rgba(34, 197, 94, 0.5);
  }

  .action-btn.accept-always {
    background: rgba(96, 165, 250, 0.15);
    border-color: rgba(96, 165, 250, 0.3);
    color: #60a5fa;
  }

  .action-btn.accept-always:hover {
    background: rgba(96, 165, 250, 0.25);
    border-color: rgba(96, 165, 250, 0.5);
  }

  .status-result {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 600;
  }

  .status-result.approved {
    background: rgba(34, 197, 94, 0.1);
    color: #4ade80;
  }

  .status-result.rejected {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .command-approval.approved {
    border-color: rgba(34, 197, 94, 0.2);
  }
  .command-approval.rejected {
    border-color: rgba(239, 68, 68, 0.2);
  }
</style>
