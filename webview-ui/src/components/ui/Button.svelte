<script lang="ts">
  let {
    variant = 'secondary',
    size = 'md',
    disabled = false,
    title = '',
    onclick,
    children,
  }: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    title?: string;
    onclick?: (e: MouseEvent) => void;
    children?: any;
  } = $props();
</script>

<button
  class="btn btn-{variant} btn-{size}"
  {disabled}
  {title}
  onclick={onclick}
>
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--font-size-sm);
    line-height: 1;
    transition: background var(--transition-fast), opacity var(--transition-fast);
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Sizes */
  .btn-sm {
    padding: var(--space-xs) var(--space-md);
    font-size: var(--font-size-xs);
  }
  .btn-md {
    padding: var(--space-sm) var(--space-lg);
  }
  .btn-lg {
    padding: var(--space-md) var(--space-xl);
    font-size: var(--font-size-md);
  }

  /* Variants */
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground);
  }

  .btn-ghost {
    background: transparent;
    color: var(--vscode-foreground);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.12));
  }

  .btn-danger {
    background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    color: var(--vscode-errorForeground, #f48771);
  }
  .btn-danger:hover:not(:disabled) {
    opacity: 0.9;
  }
</style>
