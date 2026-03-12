<script lang="ts">
    import MessageBubble from "./MessageBubble.svelte";
    import CommandApprovalDialog from "../task/CommandApprovalDialog.svelte";
    import ContextTracker from "../context/ContextTracker.svelte";
    import type { Message } from "../../stores/chatStore";

    export let messages: Message[] = [];
    export let selectedMode: string = "architect";

    let messagesContainer: HTMLElement;
    let isUserScrolling = false;
    let scrollTimeout: NodeJS.Timeout | null = null;
    let contextTrackerExpanded = false;

    function toggleContextTracker() {
        contextTrackerExpanded = !contextTrackerExpanded;
    }

    function handleScroll() {
        if (!messagesContainer) return;
        isUserScrolling = true;
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            isUserScrolling = false;
        }, 150);
    }

    let scrollSentinel: HTMLElement;

    function scrollToBottom() {
        if (scrollSentinel && !isUserScrolling) {
            scrollSentinel.scrollIntoView({ behavior: "smooth", block: "end" });
        }
    }

    $: if (messages.length > 0) {
        scrollToBottom();
    }

    // Exposure for external forcing of scroll (e.g. on new user message)
    export function forceScrollToBottom() {
        isUserScrolling = false;
        scrollToBottom();
    }
</script>

<div
    class="messages-container"
    bind:this={messagesContainer}
    on:scroll={handleScroll}
>
    <!-- Scroll Shadows -->
    <div class="scroll-shadow top"></div>
    <div class="scroll-shadow bottom"></div>

    <!-- Context Tracker - Collapsible -->
    <div class="context-tracker-wrapper">
        <button
            class="context-tracker-toggle"
            on:click={toggleContextTracker}
            aria-expanded={contextTrackerExpanded}
        >
            <span class="tracker-icon"
                >{contextTrackerExpanded ? "−" : "+"}</span
            >
            <span class="tracker-label">Context Session Details</span>
        </button>
        {#if contextTrackerExpanded}
            <div class="context-tracker-content">
                <ContextTracker />
            </div>
        {/if}
    </div>

    {#if messages.length === 0}
        <div class="empty-state">
            <div class="empty-content">
                <div class="empty-icon-wrapper">
                    <div class="empty-glow"></div>
                    <span class="empty-emoji">✨</span>
                </div>
                <h2 class="empty-title">Ready to build something great?</h2>
                <p class="empty-subtitle">
                    {selectedMode === "code"
                        ? "Code mode is ready. I can read your files, write features, and debug complex issues."
                        : selectedMode === "architect"
                          ? "Architect mode is active. Let's design the system architecture and technical plans."
                          : "Start a conversation with your AI coding assistant. Mention files with @."}
                </p>
                <div class="empty-badges">
                    <span class="badge">Explain Code</span>
                    <span class="badge">Fix Bugs</span>
                    <span class="badge">Add Features</span>
                </div>
            </div>
        </div>
    {:else}
        {#each messages as msg (msg.id)}
            {#if msg.role === "command-approval" && msg.commandApproval}
                <CommandApprovalDialog
                    commandId={msg.commandApproval.commandId}
                    command={msg.commandApproval.command}
                    cwd={msg.commandApproval.cwd}
                    reason={msg.commandApproval.reason}
                    safetyLevel={msg.commandApproval.safetyLevel}
                    status={msg.commandApproval.status}
                />
            {:else if msg.role !== "tool-execution"}
                <MessageBubble message={msg} />
            {/if}
        {/each}
        <div class="scroll-sentinel" bind:this={scrollSentinel}></div>
    {/if}
</div>

<style>
    .messages-container {
        flex: 1;
        overflow-y: auto;
        padding: 1.5rem;
        position: relative;
        scroll-behavior: smooth;
        mask-image: linear-gradient(
            to bottom,
            transparent,
            black 40px,
            black calc(100% - 40px),
            transparent
        );
    }

    .scroll-sentinel {
        height: 1px;
        width: 100%;
        margin-top: -1px;
        pointer-events: none;
    }

    .scroll-shadow {
        position: sticky;
        left: 0;
        right: 0;
        height: 30px;
        z-index: 5;
        pointer-events: none;
        opacity: 0.6;
    }

    .scroll-shadow.top {
        top: 0;
        background: linear-gradient(to bottom, var(--color-bg), transparent);
        margin-top: -1.5rem;
    }

    .scroll-shadow.bottom {
        bottom: 0;
        background: linear-gradient(to top, var(--color-bg), transparent);
        margin-bottom: -1.5rem;
    }

    .context-tracker-wrapper {
        margin-bottom: 1.5rem;
    }

    .context-tracker-toggle {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 0.75rem;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 0.5rem;
        color: inherit;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        width: 100%;
        text-align: left;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .context-tracker-toggle:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.15);
        transform: translateY(-1px);
    }

    .tracker-icon {
        font-size: 0.8rem;
        opacity: 0.5;
    }

    .tracker-label {
        opacity: 0.7;
        letter-spacing: 0.02em;
    }

    .context-tracker-content {
        margin-top: 0.75rem;
        padding: 0.75rem;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.04);
        border-radius: 0.5rem;
    }

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 80%;
        padding: 2rem;
    }

    .empty-content {
        text-align: center;
        max-width: 400px;
    }

    .empty-icon-wrapper {
        position: relative;
        width: 64px;
        height: 64px;
        margin: 0 auto 1.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .empty-glow {
        position: absolute;
        inset: -10px;
        background: var(--color-primary);
        filter: blur(25px);
        opacity: 0.15;
        border-radius: 50%;
    }

    .empty-emoji {
        font-size: 2.5rem;
        filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));
    }

    .empty-title {
        font-size: 1.25rem;
        font-weight: 700;
        margin-bottom: 0.75rem;
        color: white;
        letter-spacing: -0.01em;
    }

    .empty-subtitle {
        font-size: 0.9rem;
        line-height: 1.5;
        opacity: 0.6;
        margin-bottom: 1.5rem;
    }

    .empty-badges {
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .badge {
        font-size: 0.7rem;
        padding: 0.25rem 0.625rem;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 1rem;
        opacity: 0.5;
        transition: all 0.2s;
    }

    .badge:hover {
        opacity: 0.9;
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.2);
    }

    /* Custom Scrollbar */
    .messages-container::-webkit-scrollbar {
        width: 6px;
    }
    .messages-container::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }
</style>
