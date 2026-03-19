<script lang="ts">
  let {
    checked = false,
    label = '',
    disabled = false,
    onchange,
  }: {
    checked?: boolean;
    label?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  } = $props();

  function handleChange() {
    if (disabled) return;
    onchange?.(!checked);
  }
</script>

<label class="checkbox" class:disabled>
  <button
    class="toggle"
    class:active={checked}
    role="switch"
    aria-checked={checked}
    {disabled}
    aria-label={label || 'toggle'}
    onclick={handleChange}
  >
    <span class="toggle-thumb"></span>
  </button>
  {#if label}
    <span class="label">{label}</span>
  {/if}
</label>

<style>
  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: var(--space-md);
    cursor: pointer;
    user-select: none;
  }

  .checkbox.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle {
    position: relative;
    width: 28px;
    height: 16px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--vscode-input-background, rgba(127, 127, 127, 0.25));
    cursor: pointer;
    padding: 0;
    transition: background var(--transition-normal);
    flex-shrink: 0;
  }

  .toggle:disabled {
    cursor: not-allowed;
  }

  .toggle.active {
    background: var(--vscode-button-background);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--vscode-foreground);
    transition: transform var(--transition-normal);
  }

  .toggle.active .toggle-thumb {
    transform: translateX(12px);
    background: var(--vscode-button-foreground);
  }

  .label {
    font-size: var(--font-size-sm);
    color: var(--vscode-foreground);
  }
</style>
