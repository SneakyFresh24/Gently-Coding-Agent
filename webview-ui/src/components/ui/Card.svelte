<script lang="ts">
  export let variant: 'default' | 'elevated' | 'outlined' = 'default';
  export let padding: 'none' | 'sm' | 'md' | 'lg' = 'md';
  
  $: classes = [
    'card',
    `card-${variant}`,
    `card-padding-${padding}`
  ].join(' ');
</script>

<div class={classes}>
  <slot />
</div>

<style>
  .card {
    border-radius: var(--radius-lg);
    transition: all var(--transition-base);
  }
  
  /* Variants */
  .card-default {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
  }
  
  .card-elevated {
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    box-shadow: var(--shadow-md);
  }
  
  .card-outlined {
    background: transparent;
    border: 1px solid var(--color-border);
  }
  
  /* Padding */
  .card-padding-none { padding: 0; }
  .card-padding-sm { padding: var(--space-sm); }
  .card-padding-md { padding: var(--space-md); }
  .card-padding-lg { padding: var(--space-lg); }
</style>
