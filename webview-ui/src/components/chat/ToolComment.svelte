<script lang="ts">
  import { fade, slide } from "svelte/transition";
  import Icon from "../ui/Icon.svelte";
  import { type ToolCall, TOOL_METADATA } from "../../stores/chatStore";

  export let toolCall: ToolCall;

  let isExpanded = false;

  function toggleExpand() {
    isExpanded = !isExpanded;
  }

  $: meta = TOOL_METADATA[toolCall.function.name] || {
    icon: "Wrench",
    name: toolCall.function.name,
  };

  $: parsedArgs = (() => {
    try {
      return JSON.parse(toolCall.function.arguments);
    } catch {
      return {};
    }
  })();
</script>

<div class="tool-comment glass" transition:fade>
  <button
    class="tool-header"
    on:click={toggleExpand}
    aria-expanded={isExpanded}
  >
    <div class="tool-info">
      <div class="icon-wrapper">
        <Icon name={meta.icon} size={14} />
      </div>
      <span class="tool-name">{meta.name}</span>
      <span class="tool-status-dot"></span>
    </div>
    <span class="expand-indicator" class:expanded={isExpanded}>
      <Icon name="ChevronRight" size={12} />
    </span>
  </button>

  {#if isExpanded}
    <div class="tool-details" transition:slide>
      <div class="tool-args">
        {#each Object.entries(parsedArgs) as [key, value]}
          <div class="arg-item">
            <span class="arg-key">{key}:</span>
            <code class="arg-value">{JSON.stringify(value)}</code>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .tool-comment {
    background: rgba(34, 197, 94, 0.05);
    border: 1px solid rgba(34, 197, 94, 0.15);
    border-radius: 0.75rem;
    overflow: hidden;
    margin: 0.5rem 0;
    transition: all 0.2s ease;
  }

  .tool-comment:hover {
    background: rgba(34, 197, 94, 0.08);
    border-color: rgba(34, 197, 94, 0.25);
  }

  .tool-header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.625rem 0.875rem;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
  }

  .tool-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .icon-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 6px;
    color: rgb(34, 197, 94);
  }

  .tool-name {
    font-weight: 600;
    font-size: 0.8125rem;
    opacity: 0.9;
  }

  .tool-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(34, 197, 94);
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }

  .expand-indicator {
    opacity: 0.4;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .expand-indicator.expanded {
    transform: rotate(90deg);
  }

  .tool-details {
    padding: 0 0.875rem 0.875rem 0.875rem;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tool-args {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .arg-item {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0.5rem;
    font-size: 0.75rem;
  }

  .arg-key {
    font-weight: 600;
    opacity: 0.5;
    text-transform: uppercase;
    font-size: 0.65rem;
    letter-spacing: 0.05em;
  }

  .arg-value {
    font-family: var(--vscode-editor-font-family);
    opacity: 0.85;
    word-break: break-all;
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 6px;
    border-radius: 4px;
  }
</style>
