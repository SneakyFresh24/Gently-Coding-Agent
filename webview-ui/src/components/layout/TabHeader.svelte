<script lang="ts">
  import {
    PanelLeft,
    MessageSquare,
    ListTodo,
    FolderOpen,
  } from "lucide-svelte";

  interface Props {
    activeTab: "thread" | "task" | "context";
    showSidebar?: boolean;
    onopenSidebar?: () => void;
  }

  let {
    activeTab = $bindable("thread"),
    showSidebar = true,
    onopenSidebar,
  }: Props = $props();

  function setTab(tab: "thread" | "task" | "context") {
    activeTab = tab;
  }

  function openSidebar() {
    if (onopenSidebar) onopenSidebar();
  }
</script>

<div class="header-wrapper">
  <div class="tab-header">
    <div class="sidebar-wrapper">
      {#if !showSidebar}
        <button
          class="sidebar-toggle"
          onclick={openSidebar}
          title="Show sidebar"
          type="button"
        >
          <PanelLeft size={16} />
        </button>
      {/if}
    </div>

    <button
      class="tab"
      class:active={activeTab === "thread"}
      onclick={() => setTab("thread")}
      title="Thread"
      type="button"
    >
      <MessageSquare size={14} />
    </button>
    <button
      class="tab"
      class:active={activeTab === "task"}
      onclick={() => setTab("task")}
      title="Task"
      type="button"
    >
      <ListTodo size={14} />
    </button>
    <button
      class="tab"
      class:active={activeTab === "context"}
      onclick={() => setTab("context")}
      title="Context"
      type="button"
    >
      <FolderOpen size={14} />
    </button>
  </div>
</div>

<style>
  .header-wrapper {
    display: flex;
    flex-direction: column;
    background: var(--color-surface);
    color: var(--color-text-primary);
    border-bottom: 1px solid var(--color-border);
  }

  .tab-header {
    display: flex;
    align-items: center;
    padding: 0;
  }

  .sidebar-wrapper {
    width: 2.5rem;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .sidebar-toggle {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-base);
    opacity: 0.6;
    padding: var(--space-xs);
    border-radius: var(--radius-sm);
    font-family: inherit;
  }

  .sidebar-toggle:hover {
    opacity: 1;
    background: var(--color-surface-hover);
  }

  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-sm) 0;
    margin: 0 var(--space-xs);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.5;
    transition: all var(--transition-base);
    font-family: inherit;
  }

  .tab:hover {
    opacity: 0.8;
    background: var(--color-surface-hover);
  }

  .tab.active {
    opacity: 1;
    border-bottom-color: var(--color-text-accent);
  }
</style>
