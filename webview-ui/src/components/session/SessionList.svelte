<script lang="ts">
    import type {
        SessionGroup,
        SessionActionPayload,
    } from "../../lib/types/session";
    import SessionItem from "./SessionItem.svelte";

    let {
        filteredGroups = [],
        activeSessionId = null,
        isLoading = false,
        searchQuery = "",
        onswitchSession,
        onsessionAction,
        onnewChat,
    } = $props<{
        filteredGroups: SessionGroup[];
        activeSessionId: string | null;
        isLoading: boolean;
        searchQuery: string;
        onswitchSession?: (id: string) => void;
        onsessionAction?: (payload: SessionActionPayload) => void;
        onnewChat?: () => void;
    }>();

    function handleSessionClick(sessionId: string) {
        onswitchSession?.(sessionId);
    }

    function handleSessionAction(payload: SessionActionPayload) {
        onsessionAction?.(payload);
    }

    function handleNewChat() {
        onnewChat?.();
    }
</script>

<div class="sessions-list" role="listbox" aria-label="Chat sessions">
    {#if isLoading}
        <div class="state-container loading">
            <div class="spinner"></div>
            <p>Loading your sessions...</p>
        </div>
    {:else if filteredGroups.length === 0}
        <div class="state-container empty">
            {#if searchQuery.trim() !== ""}
                <p>No results found for "{searchQuery}"</p>
            {:else}
                <p>History is empty</p>
                <button
                    class="start-chat-btn"
                    onclick={handleNewChat}
                    type="button"
                >
                    Start your first chat
                </button>
            {/if}
        </div>
    {:else}
        {#each filteredGroups as group}
            <div class="session-group">
                <div class="group-label">
                    <span>{group.label}</span>
                    <div class="label-line"></div>
                </div>
                {#each group.sessions as session}
                    <SessionItem
                        {session}
                        isActive={session.id === activeSessionId}
                        onclick={handleSessionClick}
                        onaction={handleSessionAction}
                    />
                {/each}
            </div>
        {/each}
    {/if}
</div>

<style>
    .sessions-list {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem 0;
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    .sessions-list::-webkit-scrollbar {
        width: 6px;
    }
    .sessions-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }

    .session-group {
        margin-bottom: 1.25rem;
    }

    .group-label {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.5rem 1.25rem;
        margin-bottom: 0.25rem;
    }

    .group-label span {
        font-size: 0.625rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.4);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
        font-family: inherit;
    }

    .label-line {
        flex: 1;
        height: 1px;
        background: rgba(255, 255, 255, 0.05);
    }

    .state-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 1.5rem;
        text-align: center;
        color: rgba(255, 255, 255, 0.4);
    }

    .state-container p {
        font-size: 0.8125rem;
        margin-bottom: 1rem;
        font-family: inherit;
    }

    .start-chat-btn {
        padding: 0.5rem 1rem;
        border-radius: 6px;
        border: 1px solid rgba(59, 130, 246, 0.3);
        background: rgba(59, 130, 246, 0.1);
        color: #60a5fa;
        font-size: 0.8125rem;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
    }

    .start-chat-btn:hover {
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.5);
    }

    .spinner {
        width: 24px;
        height: 24px;
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        margin-bottom: 1rem;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
