<script lang="ts">
  import { realtimeStore } from "../../stores/realtimeStore";
  import type { Checkpoint } from "../../stores/chatStore";
  import Icon from "../ui/Icon.svelte";

  export let checkpoint: Checkpoint;
  export let messageId: string;

  function openConfirmDialog() {
    realtimeStore.setPendingCheckpointRevert({ checkpoint, messageId });
  }
</script>

<div class="checkpoint-container">
  <div class="checkpoint-badge">
    <Icon name="Save" size={14} className="checkpoint-icon" />
    <span class="checkpoint-number"
      >Checkpoint {checkpoint.checkpointNumber}</span
    >
    <span class="checkpoint-files">{checkpoint.filesTracked} files</span>
  </div>

  <button
    class="revert-button"
    on:click={openConfirmDialog}
    title="Zu diesem Checkpoint zurückkehren"
    aria-label="Revert to this checkpoint"
  >
    <Icon name="RotateCcw" size={14} />
  </button>
</div>

<style>
  .checkpoint-container {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .checkpoint-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    background: rgba(168, 85, 247, 0.15);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
    transition: all 0.2s ease;
  }

  .checkpoint-badge :global(.checkpoint-icon) {
    color: rgb(168, 85, 247);
  }

  .checkpoint-number {
    color: rgb(168, 85, 247);
  }

  .checkpoint-files {
    opacity: 0.7;
  }

  .revert-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    background: rgba(168, 85, 247, 0.15);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(168, 85, 247, 0.3);
    border-radius: 0.375rem;
    color: rgb(168, 85, 247);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .revert-button:hover {
    background: rgba(168, 85, 247, 0.3);
    border-color: rgba(168, 85, 247, 0.5);
    transform: scale(1.05);
  }

  .revert-button:active {
    transform: scale(0.95);
  }
</style>
