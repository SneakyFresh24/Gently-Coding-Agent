<script lang="ts">
  import Button from './Button.svelte';

  let {
    hasError = false,
    errorMessage = 'Something went wrong.',
    requestId = '',
    onRetry,
    onReset,
    children,
  }: {
    hasError?: boolean;
    errorMessage?: string;
    requestId?: string;
    onRetry?: () => void;
    onReset?: () => void;
    children?: any;
  } = $props();
</script>

{#if hasError}
  <div class="error-boundary" role="alert" aria-live="assertive">
    <p class="title">Chat error</p>
    <p class="message">{errorMessage}</p>
    {#if requestId}
      <p class="request-id">Request ID: {requestId}</p>
    {/if}
    <div class="actions">
      <Button variant="primary" size="sm" onclick={onRetry}>Retry</Button>
      <Button variant="secondary" size="sm" onclick={onReset}>Dismiss</Button>
    </div>
  </div>
{:else}
  {@render children?.()}
{/if}

<style>
  .error-boundary {
    margin: var(--space-md) var(--space-xl);
    padding: var(--space-lg);
    border-radius: var(--radius-md);
    border: 1px solid var(--vscode-inputValidation-errorBorder, rgba(255, 0, 0, 0.3));
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.08));
    color: var(--vscode-errorForeground, #f48771);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }

  .title {
    font-weight: 600;
    font-size: var(--font-size-sm);
  }

  .message,
  .request-id {
    font-size: var(--font-size-xs);
  }

  .actions {
    display: flex;
    gap: var(--space-sm);
    margin-top: var(--space-sm);
  }
</style>
