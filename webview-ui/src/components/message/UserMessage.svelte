<script lang="ts">
  import type { Message } from '../../lib/types';

  let {
    message,
  }: {
    message: Message;
  } = $props();

  function getFileName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }
</script>

<div class="user-message">
  <div class="message-content">{message.content}</div>

  {#if message.fileReferences && message.fileReferences.length > 0}
    <div class="file-refs">
      {#each message.fileReferences as ref}
        <span class="file-ref" title={ref.path}>
          📄 {getFileName(ref.path)}
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .user-message {
    background: var(--vscode-input-background, rgba(127, 127, 127, 0.1));
    border-radius: var(--radius-lg);
    padding: var(--space-lg);
    margin-left: var(--space-3xl);
  }

  .message-content {
    font-size: var(--font-size-sm);
    line-height: var(--line-height-relaxed);
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .file-refs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-top: var(--space-md);
  }

  .file-ref {
    font-size: var(--font-size-xxs);
    color: var(--vscode-textLink-foreground);
    background: var(--vscode-editor-background);
    padding: 2px var(--space-sm);
    border-radius: var(--radius-sm);
    cursor: default;
  }
</style>
