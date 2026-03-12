<script lang="ts">
  import {
    validationStore,
    type ValidationError,
  } from "../../stores/validationStore";
  import { X, AlertTriangle, FileCode, Lightbulb } from "lucide-svelte";
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher();

  export let show = false;

  $: errors = $validationStore.errors;
  $: file = $validationStore.currentFile;

  function close() {
    show = false;
    dispatch("close");
  }

  function getErrorIcon(type: string) {
    switch (type) {
      case "syntax":
        return "🔴";
      case "type":
        return "🟡";
      case "lint":
        return "🔵";
      default:
        return "⚠️";
    }
  }

  function getErrorColor(type: string) {
    switch (type) {
      case "syntax":
        return "#FF3B30";
      case "type":
        return "#FF9500";
      case "lint":
        return "#007AFF";
      default:
        return "#8E8E93";
    }
  }
</script>

{#if show}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="dialog-overlay" on:click={close}>
    <div class="dialog glass" on:click|stopPropagation>
      <!-- Header -->
      <div class="dialog-header">
        <div class="header-title">
          <AlertTriangle size={20} color="#FF3B30" />
          <h3>Validation Errors</h3>
        </div>
        <button class="close-btn" on:click={close} title="Close">
          <X size={18} />
        </button>
      </div>

      <!-- File Info -->
      {#if file}
        <div class="file-info">
          <FileCode size={16} />
          <span>{file}</span>
        </div>
      {/if}

      <!-- Errors List -->
      <div class="errors-list">
        {#each errors as error, i}
          <div
            class="error-item"
            style="border-left-color: {getErrorColor(error.type)}"
          >
            <div class="error-header">
              <span class="error-icon">{getErrorIcon(error.type)}</span>
              <span class="error-type">{error.type.toUpperCase()}</span>
              {#if error.line}
                <span class="error-location"
                  >Line {error.line}{error.column
                    ? `:${error.column}`
                    : ""}</span
                >
              {/if}
              {#if error.code}
                <span class="error-code">{error.code}</span>
              {/if}
            </div>
            <div class="error-message">{error.message}</div>
            {#if error.suggestion}
              <div class="error-suggestion">
                <Lightbulb size={14} />
                <span>{error.suggestion}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Footer -->
      <div class="dialog-footer">
        <button class="btn-secondary" on:click={close}> Close </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  }

  .dialog {
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    overflow: hidden;
    animation: slideUp 0.3s ease;
  }

  .glass {
    background: rgba(30, 30, 30, 0.95);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--vscode-foreground);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(0, 0, 0, 0.2);
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }

  .errors-list {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .error-item {
    background: rgba(0, 0, 0, 0.2);
    border-left: 3px solid;
    border-radius: 6px;
    padding: 12px;
  }

  .error-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .error-icon {
    font-size: 14px;
  }

  .error-type {
    font-weight: 600;
    text-transform: uppercase;
  }

  .error-location {
    color: rgba(255, 255, 255, 0.6);
  }

  .error-code {
    margin-left: auto;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-family: "Courier New", monospace;
    font-size: 11px;
  }

  .error-message {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(255, 255, 255, 0.9);
  }

  .error-suggestion {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 8px;
    background: rgba(255, 149, 0, 0.1);
    border-radius: 4px;
    font-size: 12px;
    color: #ff9500;
  }

  .dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn-secondary {
    padding: 8px 16px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: var(--vscode-foreground);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(-1px);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
