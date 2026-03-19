<script lang="ts">
  import type { Message } from '../../lib/types';
  import MarkdownBlock from './MarkdownBlock.svelte';

  let {
    message,
  }: {
    message: Message;
  } = $props();
</script>

<div class="assistant-message">
  {#if message.isStreaming && !message.content}
    <div class="thinking-indicator">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
  {:else}
    <MarkdownBlock content={message.content} />
  {/if}

  {#if message.checkpoint}
    <div class="checkpoint-badge" title="Checkpoint #{message.checkpoint.checkpointNumber}">
      💾 Checkpoint #{message.checkpoint.checkpointNumber}
      · {message.checkpoint.filesTracked} files
    </div>
  {/if}
</div>

<style>
  .assistant-message {
    padding: var(--space-sm) 0;
  }

  .thinking-indicator {
    display: flex;
    gap: var(--space-xs);
    padding: var(--space-md) 0;
  }

  .dot {
    width: 6px;
    height: 6px;
    background: var(--vscode-descriptionForeground);
    border-radius: 50%;
    animation: pulse 1.4s ease-in-out infinite;
  }

  .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }

  .checkpoint-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    margin-top: var(--space-md);
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-full);
    padding: 2px var(--space-md);
  }
</style>
