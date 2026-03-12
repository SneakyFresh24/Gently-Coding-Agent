<script lang="ts">
  import { onMount } from "svelte";
  import { extensionSync } from "../../lib/extensionSync";
  import { contextStore } from "../../stores/contextStore";
  import { Folder, Pin, PinOff, FilePlus } from "lucide-svelte";

  $: files = $contextStore.files;
  $: stats = $contextStore.stats;

  function togglePin(filePath: string) {
    contextStore.togglePin(filePath);
    extensionSync.send("togglePinFile", { filePath });
  }

  function openFile(filePath: string) {
    extensionSync.send("openFile", { path: filePath });
  }

  function addFiles() {
    extensionSync.send("addFilesToContext", {});
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function formatTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    return `${(tokens / 1000).toFixed(1)}k`;
  }
</script>

<div class="context-panel animate-scale-in">
  <div class="panel-header">
    <div class="header-left">
      <Folder size={18} class="header-icon" />
      <span class="header-title">Context Files</span>
      {#if stats}
        <span class="file-count animate-fade-in"
          >{stats.filesInContext}/{stats.totalFiles}</span
        >
      {/if}
    </div>
    <button
      class="add-files-btn"
      on:click={addFiles}
      title="Add files to context"
    >
      <FilePlus size={16} />
    </button>
  </div>

  <div class="panel-content">
    {#if stats}
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-label">Tokens:</span>
          <span class="stat-value">
            {formatTokens(stats.totalTokens)}/{formatTokens(stats.maxTokens)}
          </span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Usage:</span>
          <span class="stat-value">{stats.utilizationPercent.toFixed(0)}%</span>
        </div>
      </div>
      <div class="progress-bar">
        <div
          class="progress-fill"
          style="width: {stats.utilizationPercent}%"
          class:warning={stats.utilizationPercent > 80}
          class:danger={stats.utilizationPercent > 95}
        ></div>
      </div>
    {/if}

    {#if files.length === 0}
      <div class="empty-state">
        <p>No files in context yet</p>
        <p class="empty-hint">Files will appear here as you use them</p>
      </div>
    {:else}
      <div class="file-list">
        {#each files.filter((f) => f.inContext) as file}
          <div class="file-item" class:pinned={file.pinned}>
            <button
              class="pin-button"
              on:click={() => togglePin(file.path)}
              title={file.pinned ? "Unpin file" : "Pin file"}
            >
              {#if file.pinned}
                <Pin size={14} />
              {:else}
                <PinOff size={14} />
              {/if}
            </button>
            <button class="file-info" on:click={() => openFile(file.path)}>
              <div class="file-name">{file.path.split("/").pop()}</div>
              <div class="file-meta">
                <span class="file-path">{file.path}</span>
                <span class="file-tokens"
                  >{formatTokens(file.tokenCount)} tokens</span
                >
              </div>
            </button>
            <div class="file-score" title="Relevance score">
              {file.score.toFixed(0)}
            </div>
          </div>
        {/each}
      </div>

      {#if files.filter((f) => !f.inContext).length > 0}
        <details class="out-of-context">
          <summary>
            {files.filter((f) => !f.inContext).length} files out of context
          </summary>
          <div class="file-list">
            {#each files.filter((f) => !f.inContext) as file}
              <div class="file-item out">
                <button
                  class="pin-button"
                  on:click={() => togglePin(file.path)}
                  title="Pin file"
                >
                  <PinOff size={14} />
                </button>
                <button class="file-info" on:click={() => openFile(file.path)}>
                  <div class="file-name">{file.path.split("/").pop()}</div>
                  <div class="file-meta">
                    <span class="file-path">{file.path}</span>
                  </div>
                </button>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    {/if}
  </div>
</div>

<style>
  .context-panel {
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    overflow: hidden;
    margin-bottom: var(--space-md);
    transition: all var(--transition-slow);
  }

  .context-panel:hover {
    background: var(--color-surface-hover);
    box-shadow: var(--shadow-lg);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--color-border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .header-left :global(.header-icon) {
    flex-shrink: 0;
    opacity: 0.8;
  }

  .header-title {
    font-weight: var(--font-weight-semibold);
    font-size: var(--font-base);
  }

  .file-count {
    padding: 0.125rem 0.375rem;
    background: var(--color-primary-bg);
    border: 1px solid var(--color-primary-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-sm);
    font-weight: 600;
  }

  .add-files-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-xs);
    background: var(--color-primary-bg);
    border: 1px solid var(--color-primary-border);
    border-radius: var(--radius-md);
    color: rgb(96, 165, 250);
    cursor: pointer;
    transition: all var(--transition-base);
  }

  .add-files-btn:hover {
    background: rgba(59, 130, 246, 0.25);
    border-color: rgba(59, 130, 246, 0.5);
    transform: translateY(-1px);
  }

  .add-files-btn:active {
    transform: translateY(0);
  }

  .panel-content {
    padding: 0 1rem 1rem 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .stats-bar {
    display: flex;
    justify-content: space-between;
    margin-top: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .stat-item {
    display: flex;
    gap: 0.375rem;
    font-size: 0.75rem;
  }

  .stat-label {
    opacity: 0.7;
  }

  .stat-value {
    font-weight: 600;
  }

  .progress-bar {
    height: 0.375rem;
    background: var(--color-surface-hover);
    border-radius: var(--radius-sm);
    overflow: hidden;
    margin-bottom: var(--space-sm);
  }

  .progress-fill {
    height: 100%;
    background: var(--color-success);
    transition:
      width 0.3s ease,
      background 0.3s ease;
  }

  .progress-fill.warning {
    background: var(--color-warning);
  }

  .progress-fill.danger {
    background: var(--color-error);
  }

  .empty-state {
    text-align: center;
    padding: 2rem 1rem;
    opacity: 0.5;
  }

  .empty-state p {
    margin: 0.25rem 0;
  }

  .empty-hint {
    font-size: 0.75rem;
  }

  .file-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    transition: all var(--transition-base);
  }

  .file-item:hover {
    background: var(--color-surface-hover);
    border-color: var(--color-border-hover);
    transform: translateX(4px);
  }

  .file-item.pinned {
    border-color: rgba(168, 85, 247, 0.4);
    background: rgba(168, 85, 247, 0.1);
  }

  .file-item.out {
    opacity: 0.5;
  }
  .pin-button {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease;
    color: inherit;
  }

  .pin-button:hover {
    opacity: 1;
  }

  .file-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .file-name {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .file-meta {
    display: flex;
    gap: 0.75rem;
    font-size: 0.75rem;
    opacity: 0.7;
    margin-top: 0.125rem;
  }

  .file-path {
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-score {
    padding: 0.25rem 0.5rem;
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .out-of-context {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .out-of-context summary {
    cursor: pointer;
    font-size: 0.875rem;
    opacity: 0.7;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s ease;
  }

  .out-of-context summary:hover {
    opacity: 1;
    background: rgba(255, 255, 255, 0.05);
  }
</style>
