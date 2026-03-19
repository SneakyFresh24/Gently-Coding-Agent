<script lang="ts">
  import type { Message } from '../../lib/types';

  let {
    message,
  }: {
    message: Message;
  } = $props();

  const execution = $derived(message.toolExecution);
  const isRunning = $derived(execution?.isExecuting ?? false);

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

<div class="tool-message" class:running={isRunning}>
  <div class="tool-header">
    <span class="tool-icon">{isRunning ? '⚙️' : '✅'}</span>
    <span class="tool-name">{execution?.toolName ?? 'Tool'}</span>
    {#if execution?.duration}
      <span class="tool-duration">{formatDuration(execution.duration)}</span>
    {/if}
  </div>

  {#if execution?.fileName}
    <div class="tool-detail">
      <span class="detail-label">File:</span>
      <span class="detail-value">{execution.fileName}</span>
    </div>
  {/if}

  {#if execution?.diffStats}
    <div class="tool-diff">
      <span class="diff-added">+{execution.diffStats.added}</span>
      <span class="diff-deleted">-{execution.diffStats.deleted}</span>
    </div>
  {/if}

  {#if message.content}
    <div class="tool-content">{message.content}</div>
  {/if}
</div>

<style>
  .tool-message {
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: var(--space-md) var(--space-lg);
    background: var(--vscode-editor-background);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    font-size: var(--font-size-xs);
  }

  .tool-message.running {
    border-left-color: var(--vscode-progressBar-background, #0078d4);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-xs);
  }

  .tool-icon {
    font-size: var(--font-size-sm);
  }

  .tool-name {
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .tool-duration {
    color: var(--vscode-descriptionForeground);
    margin-left: auto;
  }

  .tool-detail {
    color: var(--vscode-descriptionForeground);
    margin-top: var(--space-xs);
  }

  .detail-label {
    opacity: 0.7;
  }

  .detail-value {
    color: var(--vscode-textLink-foreground);
  }

  .tool-diff {
    display: flex;
    gap: var(--space-md);
    margin-top: var(--space-xs);
  }

  .diff-added {
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .diff-deleted {
    color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
  }

  .tool-content {
    margin-top: var(--space-sm);
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
  }
</style>
