<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'ghost' | 'icon' = 'primary';
  export let size: 'sm' | 'md' | 'lg' = 'md';
  export let disabled: boolean = false;
  export let type: 'button' | 'submit' = 'button';
  
  const baseClasses = 'btn';
  $: classes = [
    baseClasses,
    `btn-${variant}`,
    `btn-${size}`,
    disabled ? 'btn-disabled' : ''
  ].filter(Boolean).join(' ');
</script>

<button
  {type}
  class={classes}
  {disabled}
  on:click
  on:mouseenter
  on:mouseleave
>
  <slot />
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    font-family: inherit;
    font-weight: var(--font-weight-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all var(--transition-base);
    border: 1px solid transparent;
    white-space: nowrap;
  }
  
  /* Sizes */
  .btn-sm {
    height: 28px;
    padding: 0 var(--space-sm);
    font-size: var(--font-sm);
  }
  
  .btn-md {
    height: 36px;
    padding: 0 var(--space-md);
    font-size: var(--font-base);
  }
  
  .btn-lg {
    height: 44px;
    padding: 0 var(--space-lg);
    font-size: var(--font-md);
  }
  
  /* Variants */
  .btn-primary {
    background: var(--color-primary);
    color: white;
    border-color: var(--color-primary);
  }
  
  .btn-primary:hover:not(.btn-disabled) {
    background: var(--color-primary-hover);
    border-color: var(--color-primary-hover);
  }
  
  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text-primary);
    border-color: var(--color-border);
  }
  
  .btn-secondary:hover:not(.btn-disabled) {
    background: var(--color-surface-hover);
    border-color: var(--color-border-hover);
  }
  
  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary);
    border-color: transparent;
  }
  
  .btn-ghost:hover:not(.btn-disabled) {
    background: var(--color-surface);
    color: var(--color-text-primary);
  }
  
  .btn-icon {
    background: var(--color-surface);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
    padding: 0;
  }
  
  .btn-icon:hover:not(.btn-disabled) {
    background: var(--color-surface-hover);
    color: var(--color-text-primary);
    border-color: var(--color-border-hover);
  }
  
  /* Disabled */
  .btn-disabled,
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
