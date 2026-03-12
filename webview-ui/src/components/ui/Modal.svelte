<script lang="ts">
    import { X } from "lucide-svelte";
    import { fade, scale } from "svelte/transition";

    let {
        title = "",
        message = "",
        confirmText = "Confirm",
        cancelText = "Cancel",
        type = "info",
        isOpen = $bindable(false),
        onconfirm,
        oncancel,
        onclose,
    } = $props<{
        title?: string;
        message?: string;
        confirmText?: string;
        cancelText?: string;
        type?: "info" | "warning" | "error" | "danger";
        isOpen?: boolean;
        onconfirm?: () => void;
        oncancel?: () => void;
        onclose?: () => void;
    }>();

    let modalElement = $state<HTMLElement | null>(null);

    function handleConfirm() {
        onconfirm?.();
        close();
    }

    function handleCancel() {
        oncancel?.();
        close();
    }

    function close() {
        isOpen = false;
        onclose?.();
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && isOpen) {
            handleCancel();
        }
    }

    $effect(() => {
        if (isOpen && modalElement) {
            modalElement.focus();
        }
    });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if isOpen}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="modal-backdrop"
        onclick={handleCancel}
        onkeydown={(e) => e.key === "Escape" && handleCancel()}
        transition:fade={{ duration: 200 }}
        role="button"
        tabindex="-1"
        aria-label="Close modal"
    >
        <!-- Modal Container -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="modal-container glass-dark"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            transition:scale={{ duration: 250, start: 0.95 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            tabindex="-1"
            bind:this={modalElement}
        >
            <!-- Header -->
            <div class="modal-header">
                <h2 id="modal-title" class="modal-title">{title}</h2>
                <button
                    class="close-btn"
                    onclick={handleCancel}
                    aria-label="Close modal"
                >
                    <X size={18} />
                </button>
            </div>

            <!-- Content -->
            <div class="modal-content">
                <p>{message}</p>
            </div>

            <!-- Footer -->
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick={handleCancel}>
                    {cancelText}
                </button>
                <button
                    class="btn btn-primary"
                    class:danger={type === "danger" || type === "error"}
                    onclick={handleConfirm}
                >
                    {confirmText}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        padding: 1.5rem;
        cursor: default;
        outline: none;
    }

    .modal-container {
        width: 100%;
        max-width: 400px;
        background: var(--color-surface-elevated);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-xl);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        outline: none;
        cursor: default;
    }

    .modal-header {
        padding: 1.25rem 1.5rem 0.75rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .modal-title {
        margin: 0;
        font-size: var(--font-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
    }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: var(--radius-md);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all var(--transition-fast);
    }

    .close-btn:hover {
        background: var(--color-surface-hover);
        color: var(--color-text-primary);
    }

    .modal-content {
        padding: 0.5rem 1.5rem 1.5rem;
        color: var(--color-text-secondary);
        font-size: var(--font-base);
        line-height: 1.5;
    }

    .modal-footer {
        padding: 1rem 1.5rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.75rem;
        background: rgba(255, 255, 255, 0.02);
        border-top: 1px solid var(--color-border);
    }

    .btn {
        padding: 0.5rem 1rem;
        border-radius: var(--radius-md);
        font-size: var(--font-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        transition: all var(--transition-fast);
        border: 1px solid transparent;
    }

    .btn-secondary {
        background: var(--color-surface);
        color: var(--color-text-primary);
        border-color: var(--color-border);
    }

    .btn-secondary:hover {
        background: var(--color-surface-hover);
        border-color: var(--color-border-hover);
    }

    .btn-primary {
        background: var(--color-primary);
        color: white;
    }

    .btn-primary:hover {
        background: var(--color-primary-hover);
    }

    .btn-primary.danger {
        background: var(--color-error);
    }

    .btn-primary.danger:hover {
        filter: brightness(1.1);
    }
</style>
