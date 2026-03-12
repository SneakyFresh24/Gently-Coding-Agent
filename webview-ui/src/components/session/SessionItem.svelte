<script lang="ts">
  import { fade } from "svelte/transition";
  import type {
    ChatSession,
    SessionActionPayload,
  } from "../../lib/types/session";

  let {
    session,
    isActive = false,
    onclick,
    onaction,
  } = $props<{
    session: ChatSession;
    isActive?: boolean;
    onclick?: (id: string) => void;
    onaction?: (payload: SessionActionPayload) => void;
  }>();

  let showMenu = $state(false);
  let isRenaming = $state(false);
  let newTitle = $state(session.title);
  let actionFeedback = $state<string | null>(null);

  let itemElement = $state<HTMLElement | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  function handleClick() {
    if (!isRenaming) {
      onclick?.(session.id);
    }
  }

  function toggleMenu(event: MouseEvent) {
    event.stopPropagation();
    showMenu = !showMenu;
  }

  function handleRename() {
    isRenaming = true;
    showMenu = false;
    setTimeout(() => {
      renameInput?.focus();
      renameInput?.select();
    }, 10);
  }

  function saveRename() {
    const trimmedTitle = newTitle.trim();
    if (trimmedTitle !== "" && trimmedTitle !== session.title) {
      onaction?.({
        action: "rename",
        sessionId: session.id,
        payload: { title: trimmedTitle },
      });
      isRenaming = false;
      showFeedback("Renamed");
    } else if (trimmedTitle === session.title) {
      isRenaming = false;
    }
    itemElement?.focus();
  }

  function handleBlur() {
    if (newTitle.trim() === "") {
      cancelRename();
    } else {
      saveRename();
    }
  }

  function cancelRename() {
    newTitle = session.title;
    isRenaming = false;
    itemElement?.focus();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      saveRename();
    } else if (event.key === "Escape") {
      cancelRename();
    }
  }

  function showFeedback(text: string) {
    actionFeedback = text;
    setTimeout(() => {
      actionFeedback = null;
    }, 2000);
  }

  function handleDelete() {
    onaction?.({
      action: "delete",
      sessionId: session.id,
    });
    showMenu = false;
  }

  function handleTogglePin() {
    onaction?.({
      action: session.isPinned ? "unpin" : "pin",
      sessionId: session.id,
    });
    showMenu = false;
    showFeedback(session.isPinned ? "Unpinned" : "Pinned");
    itemElement?.focus();
  }

  function handleToggleArchive() {
    onaction?.({
      action: session.isArchived ? "unarchive" : "archive",
      sessionId: session.id,
    });
    showMenu = false;
    showFeedback(session.isArchived ? "Unarchived" : "Archived");
    itemElement?.focus();
  }

  function handleClickOutside(event: MouseEvent) {
    if (showMenu) {
      const target = event.target as HTMLElement;
      if (!target.closest(".session-menu")) {
        showMenu = false;
      }
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div
  class="session-item"
  class:active={isActive}
  class:pinned={session.isPinned}
  onclick={handleClick}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && handleClick()}
  role="option"
  aria-selected={isActive}
  tabindex="0"
  bind:this={itemElement}
>
  <div class="session-icon">
    {#if session.agentMode}
      <span class="icon-agent">🤖</span>
    {:else}
      <span class="icon-chat">💬</span>
    {/if}
  </div>

  <div class="session-content">
    {#if isRenaming}
      <input
        type="text"
        class="rename-input"
        bind:value={newTitle}
        bind:this={renameInput}
        onkeydown={handleKeydown}
        onblur={handleBlur}
        onclick={(e) => e.stopPropagation()}
        aria-label="Rename chat session"
      />
    {:else}
      <div class="session-title">{session.title}</div>
      <div class="session-meta">
        {session.messageCount} message{session.messageCount !== 1 ? "s" : ""}
      </div>
    {/if}
  </div>

  <div class="session-actions">
    {#if actionFeedback}
      <span class="action-feedback" transition:fade>{actionFeedback}</span>
    {/if}

    {#if session.isPinned}
      <span class="pin-indicator" title="Pinned">📌</span>
    {/if}

    <button
      class="menu-btn"
      onclick={toggleMenu}
      title="More actions"
      id="menu-trigger-{session.id}"
      type="button"
    >
      <span class="icon-menu">⋯</span>
    </button>

    {#if showMenu}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="session-menu"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="menu"
        aria-labelledby="menu-trigger-{session.id}"
        tabindex="-1"
      >
        <button
          class="menu-item"
          onclick={handleRename}
          role="menuitem"
          type="button"
        >
          <span class="menu-icon">✏️</span>
          Rename
        </button>
        <button
          class="menu-item"
          onclick={handleTogglePin}
          role="menuitem"
          type="button"
        >
          <span class="menu-icon">{session.isPinned ? "📌" : "📍"}</span>
          {session.isPinned ? "Unpin" : "Pin"}
        </button>
        <button
          class="menu-item"
          onclick={handleToggleArchive}
          role="menuitem"
          type="button"
        >
          <span class="menu-icon">📦</span>
          {session.isArchived ? "Unarchive" : "Archive"}
        </button>
        <div class="menu-divider"></div>
        <button
          class="menu-item danger"
          onclick={handleDelete}
          role="menuitem"
          type="button"
        >
          <span class="menu-icon">🗑️</span>
          Delete
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .session-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    margin: 0 8px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-base);
    position: relative;
    background: transparent;
    outline: none;
    font-family: inherit;
  }

  .session-item:hover {
    background: var(--color-surface-hover);
  }

  .session-item.active {
    background: var(--color-surface-active);
    border-left: 3px solid var(--vscode-focusBorder, #007acc);
  }

  .session-item.pinned {
    background: var(--color-surface-1);
  }

  .session-icon {
    flex-shrink: 0;
    font-size: 16px;
    line-height: 1;
  }

  .session-content {
    flex: 1;
    min-width: 0;
  }

  .session-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .session-meta {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .rename-input {
    width: 100%;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--vscode-foreground);
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }

  .session-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;
  }

  .action-feedback {
    position: absolute;
    right: 100%;
    margin-right: 8px;
    white-space: nowrap;
    font-size: 11px;
    color: var(--color-primary);
    background: var(--color-surface-elevated);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--color-primary-soft);
    pointer-events: none;
    z-index: 10;
  }

  .pin-indicator {
    font-size: 12px;
    opacity: 0.6;
  }

  .menu-btn {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all var(--transition-fast);
  }

  .session-item:hover .menu-btn {
    opacity: 1;
  }

  .menu-btn:hover {
    background: var(--color-surface-hover);
    color: var(--color-text-primary);
  }

  .icon-menu {
    font-size: 16px;
    line-height: 1;
  }

  .session-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 160px;
    background: var(--color-surface-elevated);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    z-index: 1000;
    overflow: hidden;
    outline: none;
    font-family: inherit;
  }

  .menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background var(--transition-fast);
    font-family: inherit;
  }

  .menu-item:hover {
    background: var(--color-surface-active);
  }

  .menu-item.danger {
    color: var(--color-error);
  }

  .menu-item.danger:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .menu-icon {
    font-size: 14px;
  }

  .menu-divider {
    height: 1px;
    background: var(--color-border);
    margin: 4px 0;
  }
</style>
