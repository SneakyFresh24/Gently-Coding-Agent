<script lang="ts">
  import { extensionSync } from "../../lib/extensionSync";
  import { fade, slide } from "svelte/transition";
  import AgentSettings from "./AgentSettings.svelte";
  import ModelParameters from "./ModelParameters.svelte";
  import AccountSettings from "./AccountSettings.svelte";

  export let isOpen = false;

  function close() {
    isOpen = false;
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      close();
    }
  }

  function handleChangeApiKey() {
    extensionSync.send("deleteApiKey", {});
    close();
  }

  function handleOpenMemories() {
    extensionSync.send("openMemories", {});
    close();
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div
    class="settings-backdrop"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 200 }}
  >
    <div
      class="settings-menu glass"
      transition:slide={{ duration: 300, axis: "y" }}
    >
      <!-- Header -->
      <div class="menu-header">
        <h3 class="menu-title">⚙️ Settings</h3>
        <button
          class="close-button"
          on:click={close}
          aria-label="Close Settings">✕</button
        >
      </div>

      <!-- Content -->
      <div class="menu-content">
        <AgentSettings />

        <div class="divider"></div>

        <ModelParameters />

        <div class="divider"></div>

        <AccountSettings
          on:openMemories={handleOpenMemories}
          on:changeApiKey={handleChangeApiKey}
        />
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .settings-menu {
    width: 90%;
    max-width: 480px;
    max-height: 85vh;
    background: rgba(23, 23, 23, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 1.25rem;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }

  .menu-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
  }

  .menu-title {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0;
    letter-spacing: -0.01em;
  }

  .close-button {
    background: rgba(255, 255, 255, 0.05);
    border: none;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 0.875rem;
    color: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .close-button:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: rotate(90deg);
  }

  .menu-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  /* Custom Scrollbar */
  .menu-content::-webkit-scrollbar {
    width: 6px;
  }
  .menu-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }

  .divider {
    height: 1px;
    background: linear-gradient(
      to right,
      transparent,
      rgba(255, 255, 255, 0.1),
      transparent
    );
    margin: 1.5rem 0;
  }

  .glass {
    backdrop-filter: blur(20px);
  }
</style>
