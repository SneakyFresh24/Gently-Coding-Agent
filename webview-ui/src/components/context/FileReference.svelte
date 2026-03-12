<script lang="ts">
  import { extensionSync } from "../../lib/extensionSync";
  import type { FileReference as FileRef } from "../../stores/chatStore";

  export let file: FileRef;

  function openFile() {
    extensionSync.send("openFile", { path: file.path });
  }

  function formatSize(bytes: number | undefined): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function hasDiffStats(
    stats: { added: number; deleted: number } | undefined,
  ): boolean {
    return !!stats && (stats.added > 0 || stats.deleted > 0);
  }
</script>

<button
  class="file-reference glass-hover"
  on:click={openFile}
  title="Click to open {file.path}"
>
  <span class="file-icon">📄</span>
  <span class="file-name">{file.displayName}</span>
  {#if hasDiffStats(file.diffStats)}
    <span class="diff-stats">
      {#if file.diffStats && file.diffStats.added > 0}
        <span class="diff-added">+{file.diffStats.added}</span>
      {/if}
      {#if file.diffStats && file.diffStats.deleted > 0}
        <span class="diff-deleted">-{file.diffStats.deleted}</span>
      {/if}
    </span>
  {/if}
  {#if file.size}
    <span class="file-size">{formatSize(file.size)}</span>
  {/if}
</button>

<style>
  .file-reference {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    padding: 0.375rem 0.75rem;
    background: var(--color-surface);
    backdrop-filter: blur(10px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    font-size: var(--font-base);
    cursor: pointer;
    transition: all var(--transition-base);
  }

  .file-reference:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-border-hover);
    transform: translateY(-1px);
  }

  .file-icon {
    font-size: 1rem;
  }

  .file-name {
    font-weight: 500;
  }

  .diff-stats {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-size: var(--font-sm);
    font-weight: 600;
    font-family: "SF Mono", "Monaco", "Cascadia Code", "Courier New", monospace;
  }

  .diff-added {
    color: var(--color-success);
  }

  .diff-deleted {
    color: var(--color-error);
  }

  .file-size {
    opacity: 0.6;
    font-size: var(--font-sm);
  }
</style>
