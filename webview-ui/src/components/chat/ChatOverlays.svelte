<script lang="ts">
    import { realtimeStore } from "../../stores/realtimeStore";
    import ValidationErrorDialog from "../validation/ValidationErrorDialog.svelte";
    import CheckpointRevertDialog from "./CheckpointRevertDialog.svelte";

    $: showValidationDialog = $realtimeStore.showValidationDialog;
    $: pendingCheckpointRevert = $realtimeStore.pendingCheckpointRevert;

    function closeValidationDialog() {
        realtimeStore.setShowValidationDialog(false);
    }
</script>

{#if showValidationDialog}
    <ValidationErrorDialog
        bind:show={showValidationDialog}
        on:close={closeValidationDialog}
    />
{/if}

{#if pendingCheckpointRevert}
    <CheckpointRevertDialog
        checkpoint={pendingCheckpointRevert.checkpoint}
        messageId={pendingCheckpointRevert.messageId}
    />
{/if}
