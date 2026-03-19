<script lang="ts">
  let {
    path = '',
    onRemove,
  }: {
    path?: string;
    onRemove?: () => void;
  } = $props();

  function getFileName(p: string): string {
    return p.split(/[/\\]/).pop() || p;
  }
</script>

<span class="file-chip" title={path}>
  <span class="file-icon">📄</span>
  <span class="file-name truncate">{getFileName(path)}</span>
  {#if onRemove}
    <button class="remove-btn" onclick={onRemove} title="Remove file" aria-label="Remove {getFileName(path)}">
      ✕
    </button>
  {/if}
</span>

<style>
  .file-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    padding: 2px var(--space-md);
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xxs);
    max-width: 180px;
  }

  .file-icon {
    font-size: var(--font-size-xs);
    flex-shrink: 0;
  }

  .file-name {
    color: var(--vscode-textLink-foreground);
  }

  .remove-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: var(--font-size-xxs);
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
  }

  .remove-btn:hover {
    color: var(--vscode-errorForeground);
  }
</style>
