<script lang="ts">
  let {
    label,
    description = '',
    risky = false,
    enabled = false,
    onToggle
  }: {
    label: string;
    description?: string;
    risky?: boolean;
    enabled?: boolean;
    onToggle?: (enabled: boolean) => void;
  } = $props();
</script>

<div class="setting-item" class:risky>
  <div class="item-info">
    <div class="label-row">
      <span class="label">{label}</span>
      {#if risky}
        <span class="badge risky">Risky</span>
      {/if}
    </div>
    <span class="description">{description}</span>
  </div>
  
  <div class="toggle-container">
    <button 
      class="toggle-btn" 
      class:active={enabled}
      onclick={() => onToggle?.(!enabled)}
      aria-label="Toggle {label}"
    >
      <div class="toggle-track">
        <div class="toggle-thumb"></div>
      </div>
    </button>
  </div>
</div>

<style>
  .setting-item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 8px 10px;
    border-radius: 8px;
    transition: background 0.2s;
  }

  .setting-item:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .label-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .description {
    font-size: 11px;
    line-height: 1.3;
    opacity: 0.6;
  }

  .badge {
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .badge.risky {
    background: var(--vscode-errorForeground);
    color: var(--vscode-editor-background);
  }

  .toggle-container {
    padding-top: 2px;
  }

  .toggle-btn {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    width: 28px;
    height: 16px;
    transition: opacity 0.2s;
  }

  .toggle-track {
    width: 28px;
    height: 16px;
    background: var(--vscode-editorWidget-border);
    border-radius: 8px;
    position: relative;
    transition: background 0.2s;
  }

  .toggle-btn.active .toggle-track {
    background: var(--vscode-button-background);
  }

  .toggle-thumb {
    width: 12px;
    height: 12px;
    background: #fff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .toggle-btn.active .toggle-thumb {
    transform: translateX(12px);
  }
</style>
