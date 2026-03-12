<script lang="ts">
    import { scale, fade } from "svelte/transition";
    import { realtimeStore } from "../../stores/realtimeStore";
    import { chatActions } from "../../lib/chatActions";
    import Icon from "../ui/Icon.svelte";
    import type { Checkpoint } from "../../stores/chatStore";

    export let checkpoint: Checkpoint;
    export let messageId: string;

    function closeDialog() {
        realtimeStore.setPendingCheckpointRevert(null);
    }

    function confirmRevert() {
        chatActions.revertCheckpoint(checkpoint.id, messageId);
        closeDialog();
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="dialog-overlay"
    on:click={closeDialog}
    transition:fade={{ duration: 200 }}
>
    <div
        class="dialog-content"
        on:click={(e) => e.stopPropagation()}
        transition:scale={{ duration: 250, start: 0.95 }}
    >
        <div class="dialog-header">
            <h3>Checkpoint wiederherstellen</h3>
            <button
                class="dialog-close"
                on:click={closeDialog}
                aria-label="Close dialog"
            >
                <Icon name="X" size={16} />
            </button>
        </div>
        <div class="dialog-body">
            <p>
                Möchten Sie wirklich zu <strong
                    >Checkpoint {checkpoint.checkpointNumber}</strong
                > zurückkehren?
            </p>
            <p class="dialog-warning">
                ⚠️ Alle nachfolgenden Änderungen gehen verloren.
            </p>
        </div>
        <div class="dialog-footer">
            <button
                class="dialog-button dialog-button-cancel"
                on:click={closeDialog}
            >
                Cancel
            </button>
            <button
                class="dialog-button dialog-button-confirm"
                on:click={confirmRevert}
            >
                Zurückkehren
            </button>
        </div>
    </div>
</div>

<style>
    .dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }

    .dialog-content {
        background: rgba(30, 30, 30, 0.95);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 0.75rem;
        padding: 1.5rem;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    .dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
    }

    .dialog-header h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
    }

    .dialog-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .dialog-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
    }

    .dialog-warning {
        margin-top: 1rem;
        padding: 0.75rem;
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.2);
        border-radius: 0.5rem;
        color: #f87171;
        font-size: 0.875rem;
    }

    .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 0.75rem;
        margin-top: 1.5rem;
    }

    .dialog-button {
        padding: 0.5rem 1rem;
        border-radius: 0.5rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
    }

    .dialog-button-cancel {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    }

    .dialog-button-cancel:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .dialog-button-confirm {
        background: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: white;
    }

    .dialog-button-confirm:hover {
        background: #dc2626;
    }
</style>
