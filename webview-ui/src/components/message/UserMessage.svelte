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

  const quotePreview = $derived(
    message.content
      .split('\n')
      .find((line) => line.trim().startsWith('>'))?.replace(/^>\s?/, '') || ''
  );
</script>

<div class="user-message">
  <div class="user-header">You</div>
  {#if quotePreview}
    <div class="quote-preview" title={quotePreview}>
      Replying to: {quotePreview}
    </div>
  {/if}
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
    position: relative;
  }

  .user-header {
    position: sticky;
    top: 0;
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-xs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: inherit;
  }

  .quote-preview {
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
    border-left: 2px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    padding-left: var(--space-sm);
    margin-bottom: var(--space-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
