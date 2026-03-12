<script lang="ts">
    import { Search, Trash2, PanelLeftClose, Plus } from "lucide-svelte";

    let {
        searchQuery = "",
        onsearch,
        onnewChat,
        onclearAll,
        oncloseSidebar,
    } = $props<{
        searchQuery?: string;
        onsearch?: (query: string) => void;
        onnewChat?: () => void;
        onclearAll?: () => void;
        oncloseSidebar?: () => void;
    }>();

    function handleSearchInput(e: Event) {
        const target = e.target as HTMLInputElement;
        onsearch?.(target.value);
    }
</script>

<div class="sidebar-header-container">
    <div class="sidebar-header">
        <h3>Chat Sessions</h3>
        <div class="header-actions">
            <button
                class="icon-btn danger"
                onclick={onclearAll}
                title="Clear All Sessions"
                aria-label="Clear all sessions"
                type="button"
            >
                <Trash2 size={16} />
            </button>
            <button
                class="icon-btn"
                onclick={oncloseSidebar}
                title="Hide sidebar"
                aria-label="Close sidebar"
                type="button"
            >
                <PanelLeftClose size={18} />
            </button>
            <button
                class="icon-btn primary"
                onclick={onnewChat}
                title="New Chat"
                aria-label="Start new chat"
                type="button"
            >
                <Plus size={18} />
            </button>
        </div>
    </div>

    <div class="search-container">
        <div class="search-wrapper">
            <Search size={14} />
            <input
                type="text"
                class="search-input"
                placeholder="Search history..."
                value={searchQuery}
                oninput={handleSearchInput}
                aria-label="Search chat sessions"
            />
        </div>
    </div>
</div>

<style>
    .sidebar-header-container {
        background: rgba(255, 255, 255, 0.02);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .sidebar-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
    }

    .sidebar-header h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        opacity: 0.9;
        font-family: inherit;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .icon-btn {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        font-family: inherit;
    }

    .icon-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.15);
        transform: translateY(-1px);
    }

    .icon-btn:active {
        transform: translateY(0);
    }

    .icon-btn.primary {
        background: rgba(59, 130, 246, 0.15);
        border-color: rgba(59, 130, 246, 0.3);
        color: #60a5fa;
    }

    .icon-btn.primary:hover {
        background: rgba(59, 130, 246, 0.25);
        border-color: rgba(59, 130, 246, 0.5);
    }

    .icon-btn.danger:hover {
        background: rgba(239, 68, 68, 0.15);
        border-color: rgba(239, 68, 68, 0.3);
        color: #f87171;
    }

    .search-container {
        padding: 0 1.25rem 1rem 1.25rem;
    }

    .search-wrapper {
        position: relative;
        display: flex;
        align-items: center;
    }

    .search-wrapper :global(svg) {
        position: absolute;
        left: 10px;
        opacity: 0.4;
        pointer-events: none;
        color: inherit;
    }

    .search-input {
        width: 100%;
        padding: 0.5rem 0.75rem 0.5rem 2.25rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(0, 0, 0, 0.2);
        color: inherit;
        font-size: 0.8125rem;
        outline: none;
        transition: all 0.2s;
        font-family: inherit;
    }

    .search-input:focus {
        border-color: rgba(59, 130, 246, 0.4);
        background: rgba(0, 0, 0, 0.3);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }

    .search-input::placeholder {
        color: rgba(255, 255, 255, 0.3);
    }
</style>
