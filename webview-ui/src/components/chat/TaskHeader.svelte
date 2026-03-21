<script lang="ts">
  import type { Task } from '../../lib/types';
  import Icon from '../ui/Icon.svelte';

  let {
    task,
    progress = null,
  }: {
    task: Task | null;
    progress?: {
      label: string;
      progress: number | null;
      totalCount: number;
      completedCount: number;
      currentIndex: number;
    } | null;
  } = $props();
</script>

{#if task}
  <div class="task-header">
    <div class="task-icon">
      <Icon name="rocket" size={14} />
    </div>
    <div class="task-info">
      <span class="task-label">Task</span>
      <span class="task-text">{task.text}</span>
      {#if progress}
        <div class="task-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.progress || 0} aria-label="Task progress">
          <div class="task-progress-fill" style={`width: ${progress.progress || 0}%`}></div>
        </div>
        <div class="task-meta">
          {#if progress.totalCount > 0}
            <span>{progress.completedCount}/{progress.totalCount}</span>
          {/if}
          {#if progress.currentIndex > 0}
            <span>Current: {progress.currentIndex}</span>
          {/if}
          <span class="task-current">{progress.label}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .task-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-md);
    padding: var(--space-md) var(--space-xl);
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border);
  }

  .task-icon {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--vscode-textLink-foreground);
  }

  .task-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .task-label {
    font-size: var(--font-size-xxs);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }

  .task-text {
    font-size: var(--font-size-sm);
    color: var(--vscode-foreground);
    line-height: var(--line-height-normal);
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .task-progress {
    width: 100%;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.2));
    margin-top: var(--space-sm);
    overflow: hidden;
  }

  .task-progress-fill {
    height: 100%;
    background: var(--vscode-progressBar-background);
    transition: width 0.2s ease;
  }

  .task-meta {
    display: flex;
    gap: var(--space-sm);
    margin-top: var(--space-xs);
    color: var(--vscode-descriptionForeground);
    font-size: var(--font-size-xxs);
    white-space: nowrap;
    overflow: hidden;
  }

  .task-current {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
