<script lang="ts">
  import type { Message } from '../../lib/types';

  let {
    message,
  }: {
    message: Message;
  } = $props();
</script>

<div class="error-message">
  <span class="error-icon">⚠️</span>
  <span class="error-text">{message.content}</span>
</div>

<style>
  .error-message {
    display: flex;
    align-items: flex-start;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-lg);
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
    border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(255, 0, 0, 0.3));
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--vscode-errorForeground, #f48771);
  }

  .error-icon {
    flex-shrink: 0;
    font-size: var(--font-size-lg);
  }

  .error-text {
    line-height: var(--line-height-normal);
    word-wrap: break-word;
  }
</style>
