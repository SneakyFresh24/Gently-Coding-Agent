<script lang="ts">
  import type { Message } from '../../lib/types';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import LoadingIndicator from '../ui/LoadingIndicator.svelte';

  let {
    message,
  }: {
    message: Message;
  } = $props();
</script>

<div class="assistant-message">
  {#if message.isStreaming && !message.content}
    <div class="thinking-indicator">
      <LoadingIndicator label="Assistant is thinking" size="sm" />
      <span class="thinking-shimmer" aria-hidden="true"></span>
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
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-md) 0;
  }

  .thinking-shimmer {
    width: 140px;
    height: 8px;
    border-radius: var(--radius-full);
    background: linear-gradient(
      90deg,
      rgba(127, 127, 127, 0.12) 0%,
      rgba(127, 127, 127, 0.4) 50%,
      rgba(127, 127, 127, 0.12) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
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
