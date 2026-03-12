<script lang="ts">
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    function openMemories() {
        dispatch("openMemories");
    }

    function changeApiKey() {
        dispatch("changeApiKey");
    }
</script>

<div class="actions-section">
    <button
        class="action-button"
        on:click={openMemories}
        aria-label="Manage Memories"
    >
        <span class="action-icon">🧠</span>
        <span class="action-label">Memories</span>
        <span class="action-arrow">→</span>
    </button>

    <button
        class="action-button danger"
        on:click={changeApiKey}
        aria-label="Change API Key"
    >
        <span class="action-icon">🔑</span>
        <span class="action-label">Change API Key</span>
        <span class="action-arrow">→</span>
    </button>
</div>

<style>
    .actions-section {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        margin-top: 1.5rem;
    }

    .action-button {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.75rem;
        color: inherit;
        font-size: 0.875rem;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        text-align: left;
    }

    .action-button:hover {
        background: rgba(255, 255, 255, 0.07);
        border-color: rgba(255, 255, 255, 0.15);
        transform: translateX(4px);
    }

    .action-button:active {
        transform: translateX(2px);
    }

    .action-button.danger {
        border-color: rgba(239, 68, 68, 0.2);
    }

    .action-button.danger:hover {
        background: rgba(239, 68, 68, 0.08);
        border-color: rgba(239, 68, 68, 0.4);
    }

    .action-icon {
        font-size: 1.25rem;
    }

    .action-label {
        flex: 1;
        font-weight: 600;
    }

    .action-arrow {
        opacity: 0.4;
        font-size: 0.8rem;
    }
</style>
