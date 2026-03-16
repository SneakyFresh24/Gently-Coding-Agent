<script lang="ts">
    import ModelSelector from "../ui/ModelSelector.svelte";
    import ModeSelector from "../ui/ModeSelector.svelte";
    import TerminalModeToggle from "../terminal/TerminalModeToggle.svelte";
    import ValidationIndicator from "../validation/ValidationIndicator.svelte";
    import { Brain, Sparkles, ShieldCheck } from "lucide-svelte";
    import { realtimeStore } from "../../stores/realtimeStore";
    import { chatActions } from "../../lib/chatActions";

    interface Props {
        selectedMode?: string;
        messageLength?: number;
        onenhancePrompt?: () => void;
        ontoggleAutoApprove?: () => void;
    }

    let {
        selectedMode = "architect",
        messageLength = 0,
        onenhancePrompt,
        ontoggleAutoApprove,
    }: Props = $props();

    let isEnhancing = $derived($realtimeStore.isEnhancing);
    let showEnhanceSuccess = $derived($realtimeStore.showEnhanceSuccess);

    function openMemories() {
        chatActions.openMemories();
    }

    function showValidationDialog() {
        chatActions.showValidationError(
            "Validation logic failed or requires your attention.",
        );
    }

    function enhancePrompt() {
        if (messageLength === 0) return;
        if (onenhancePrompt) onenhancePrompt();
    }
</script>

<div class="bottom-bar">
    <div class="bottom-bar-left">
        <ModelSelector />
        <ModeSelector />
        {#if selectedMode === "code"}
            <TerminalModeToggle />
        {/if}
        <button
            class="icon-button"
            onclick={openMemories}
            title="Memories"
            aria-label="Open Memories"
        >
            <Brain size={14} />
        </button>
        <button
            class="icon-button enhance"
            class:enhancing={isEnhancing}
            class:success={showEnhanceSuccess}
            onclick={enhancePrompt}
            disabled={messageLength === 0 || isEnhancing}
            title={isEnhancing ? "Enhancing..." : "Enhance prompt"}
            aria-label="Enhance prompt"
        >
            <Sparkles size={14} />
        </button>
        <button
            class="icon-button"
            onclick={ontoggleAutoApprove}
            title="Auto-Approval Settings"
            aria-label="Toggle Auto-Approval Settings"
        >
            <ShieldCheck size={14} />
        </button>
        <ValidationIndicator onshowErrors={showValidationDialog} />
    </div>
</div>

<style>
    .bottom-bar {
        padding: 0.5rem 1.25rem;
        border-top: 1px solid rgba(255, 255, 255, 0.04);
        background: rgba(30, 30, 38, 0.4);
        backdrop-filter: blur(12px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: relative;
        z-index: 100;
        border-radius: 1.5rem 1.5rem 0 0;
    }

    .bottom-bar-left {
        display: flex;
        align-items: center;
        gap: 0.625rem;
    }

    .icon-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: inherit;
    }

    .icon-button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
        color: white;
        transform: translateY(-2px);
    }

    .icon-button:active:not(:disabled) {
        transform: translateY(0);
    }

    .icon-button.enhance {
        background: linear-gradient(
            135deg,
            rgba(139, 92, 246, 0.15),
            rgba(168, 85, 247, 0.15)
        );
        border-color: rgba(139, 92, 246, 0.4);
        color: rgb(196, 181, 253);
    }

    .icon-button.enhance:hover:not(:disabled) {
        background: linear-gradient(
            135deg,
            rgba(139, 92, 246, 0.25),
            rgba(168, 85, 247, 0.25)
        );
        border-color: rgba(139, 92, 246, 0.6);
        box-shadow: 0 0 15px rgba(139, 92, 246, 0.3);
    }

    .icon-button.enhance:disabled {
        opacity: 0.4;
        cursor: not-allowed;
        filter: grayscale(1);
    }

    .icon-button.enhance.enhancing {
        animation: pulseEnhanced 1s ease-in-out infinite;
        border-color: var(--color-primary);
        color: white;
    }

    .icon-button.enhance.success {
        background: linear-gradient(
            135deg,
            rgba(34, 197, 94, 0.25),
            rgba(22, 163, 74, 0.25)
        );
        border-color: rgba(34, 197, 94, 0.6);
        color: rgb(134, 239, 172);
        box-shadow: 0 0 15px rgba(34, 197, 94, 0.3);
    }

    @keyframes pulseEnhanced {
        0% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
            transform: scale(1);
        }
        50% {
            box-shadow: 0 0 15px 5px rgba(139, 92, 246, 0.2);
            transform: scale(1.05);
        }
        100% {
            box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.4);
            transform: scale(1);
        }
    }
</style>
