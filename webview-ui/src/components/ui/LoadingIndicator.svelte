<script lang="ts">
  let {
    label = 'Loading',
    size = 'md',
  }: {
    label?: string;
    size?: 'sm' | 'md' | 'lg';
  } = $props();
</script>

<span
  class="loading-spinner {size}"
  role="status"
  aria-label={label}
  title={label}
>
  <i class="codicon codicon-loading" aria-hidden="true"></i>
</span>

<style>
  .loading-spinner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--vscode-progressBar-background, #0e70c0);
    animation: spin 1s linear infinite;
  }

  .loading-spinner.sm {
    font-size: 12px;
  }

  .loading-spinner.md {
    font-size: 16px;
  }

  .loading-spinner.lg {
    font-size: 20px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
