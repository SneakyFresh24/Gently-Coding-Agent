<script lang="ts">
    import { chatStore } from "../../stores/chatStore";
    import Icon from "../ui/Icon.svelte";

    export let error: string;
</script>

<div class="error-banner">
    <span class="error-icon">
        <Icon name="AlertCircle" size={16} />
    </span>
    <span class="error-message">{error}</span>
    <button
        class="error-close"
        on:click={() => chatStore.clearError()}
        aria-label="Close error"
    >
        <Icon name="X" size={16} />
    </button>
</div>

<style>
    .error-banner {
        padding: 0.5rem 1rem;
        background: rgba(239, 68, 68, 0.15);
        border-bottom: 1px solid rgba(239, 68, 68, 0.3);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        animation: slideDown 0.2s ease-out;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .error-message {
        flex: 1;
        font-size: 0.8rem;
        color: rgb(254, 202, 202);
    }

    .error-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgb(248, 113, 113);
    }

    .error-close {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        padding: 0.25rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .error-close:hover {
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
    }
</style>
