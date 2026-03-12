<script lang="ts">
  import { onMount } from "svelte";
  import SessionSidebar from "../session/SessionSidebar.svelte";
  import ChatView from "../chat/ChatView.svelte";

  let showSidebar = $state(true);
  let sidebarWidth = $state(280);
  let isResizing = $state(false);

  // Load sidebar state from settings
  onMount(() => {
    const savedState = localStorage.getItem("gently.sidebarVisible");
    if (savedState !== null) {
      showSidebar = savedState === "true";
    }

    const savedWidth = localStorage.getItem("gently.sidebarWidth");
    if (savedWidth) {
      sidebarWidth = parseInt(savedWidth, 10);
    }
  });

  function toggleSidebar() {
    showSidebar = !showSidebar;
    localStorage.setItem("gently.sidebarVisible", showSidebar.toString());
  }

  function startResize(event: MouseEvent) {
    isResizing = true;
    event.preventDefault();
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isResizing) return;

    const newWidth = event.clientX;
    if (newWidth >= 200 && newWidth <= 500) {
      sidebarWidth = newWidth;
      localStorage.setItem("gently.sidebarWidth", sidebarWidth.toString());
    }
  }

  function stopResize() {
    isResizing = false;
  }
</script>

<svelte:window onmousemove={handleMouseMove} onmouseup={stopResize} />

<div class="chat-layout" class:sidebar-hidden={!showSidebar}>
  <!-- Sidebar -->
  {#if showSidebar}
    <div class="sidebar-container" style="width: {sidebarWidth}px">
      <SessionSidebar oncloseSidebar={toggleSidebar} />

      <!-- Resize Handle -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        onmousedown={startResize}
        role="separator"
      ></div>
    </div>
  {/if}

  <!-- Main Chat Area -->
  <div class="chat-container">
    <ChatView {showSidebar} onopenSidebar={toggleSidebar} />
  </div>
</div>

<style>
  .chat-layout {
    display: flex;
    height: 100vh;
    width: 100%;
    overflow: hidden;
    background: var(--color-surface);
  }

  .sidebar-container {
    position: relative;
    flex-shrink: 0;
    height: 100%;
    min-width: 200px;
    max-width: 500px;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 4px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    transition: background var(--transition-base);
  }

  .resize-handle:hover,
  .resize-handle:active {
    background: var(--color-border-hover);
  }

  .chat-container {
    flex: 1;
    position: relative;
    height: 100%;
    overflow: hidden;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .sidebar-container {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      z-index: 50;
      box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3);
    }

    .resize-handle {
      display: none;
    }
  }
</style>
