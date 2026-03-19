<script lang="ts">
  import type { ActionMeta } from './constants';
  import Checkbox from '../ui/Checkbox.svelte';
  import Icon from '../ui/Icon.svelte';

  let {
    action,
    checked = false,
    onToggle,
  }: {
    action: ActionMeta;
    checked?: boolean;
    onToggle?: (enabled: boolean) => void;
  } = $props();
</script>

<div class="approve-item">
  <div class="item-row">
    <Icon name={action.icon} size={14} />
    <span class="item-label">{action.label}</span>
    <Checkbox
      {checked}
      onchange={(val) => onToggle?.(val)}
    />
  </div>
</div>

<style>
  .approve-item {
    padding: var(--space-xs) 0;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-xs) var(--space-sm);
    border-radius: var(--radius-sm);
  }

  .item-row:hover {
    background: var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.08));
  }

  .item-label {
    flex: 1;
    font-size: var(--font-size-sm);
    color: var(--vscode-foreground);
  }
</style>
