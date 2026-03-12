<script lang="ts">
    import FileReferenceInput from "../context/FileReferenceInput.svelte";
    import { Send, Square } from "lucide-svelte";
    import type { FileReference } from "../../stores/chatStore";
    import { realtimeStore } from "../../stores/realtimeStore";
    import { chatActions } from "../../lib/chatActions";

    interface Props {
        message: string;
        selectedMode?: string;
        pendingFileReferences: FileReference[];
        onsend?: (data: {
            message: string;
            fileReferences: FileReference[];
        }) => void;
    }

    let {
        message = $bindable(""),
        selectedMode = "architect",
        pendingFileReferences = $bindable([]),
        onsend,
    }: Props = $props();

    let isGenerating = $derived($realtimeStore.isGenerating);

    function handleSend() {
        if (isGenerating || !message.trim()) return;
        if (onsend) {
            onsend({
                message: message.trim(),
                fileReferences: [...pendingFileReferences],
            });
        }
        message = "";
        pendingFileReferences = [];
    }

    function handleStop() {
        chatActions.stopGeneration();
    }
</script>

<div class="input-area">
    <FileReferenceInput
        bind:value={message}
        bind:externalFileReferences={pendingFileReferences}
        disabled={isGenerating}
        placeholder={selectedMode === "code"
            ? "Ask me to read files, search code, or build features... (@ for files)"
            : selectedMode === "architect"
              ? "Ask me to plan and design... (@ for files)"
              : "Type your message... (@ for files)"}
        onsend={handleSend}
    />
    <div class="input-actions">
        {#if isGenerating}
            <button
                class="stop-button"
                onclick={handleStop}
                title="Stop generation"
                aria-label="Stop generation"
            >
                <Square size={16} />
            </button>
        {:else}
            <button
                class="send-button"
                onclick={handleSend}
                disabled={!message.trim()}
                title="Send message"
                aria-label="Send message"
            >
                <Send size={16} />
            </button>
        {/if}
    </div>
</div>

<style>
    .input-area {
        position: relative;
        padding: 1rem 1.25rem;
        background: rgba(30, 30, 38, 0.75);
        backdrop-filter: blur(16px) saturate(180%);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.35);
        border-radius: 16px 16px 0 0;
        z-index: 10;
    }

    .input-actions {
        position: absolute;
        right: 1.5rem;
        bottom: 1.75rem;
        display: flex;
        gap: 0.5rem;
    }

    .send-button,
    .stop-button {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border: none;
        font-family: inherit;
    }

    .send-button {
        background: var(--color-primary);
        color: white;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }
    .send-button:hover:not(:disabled) {
        background: var(--color-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
    }
    .send-button:active:not(:disabled) {
        transform: translateY(0);
    }
    .send-button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        background: var(--color-border);
        box-shadow: none;
    }

    .stop-button {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #f87171;
    }
    .stop-button:hover {
        background: rgba(239, 68, 68, 0.25);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    .stop-button:active {
        transform: translateY(0);
    }
</style>
