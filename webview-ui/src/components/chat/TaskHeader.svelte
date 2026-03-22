<script lang="ts">
  import type { Task } from '../../lib/types';
  import Icon from '../ui/Icon.svelte';
  import ActivityIndicator from './ActivityIndicator.svelte';
  import type { ToolCallInfo } from '../../lib/types';

  let {
    task,
    activityLabel = null as string | null,
    activityPhase = 'idle' as 'idle' | 'sending' | 'thinking' | 'tooling',
    activeToolCalls = [] as ToolCallInfo[],
  }: {
    task: Task | null;
    activityLabel?: string | null;
    activityPhase?: 'idle' | 'sending' | 'thinking' | 'tooling';
    activeToolCalls?: ToolCallInfo[];
  } = $props();
</script>

{#if task || activityLabel || activeToolCalls.length > 0}
  <div class="task-header">
    {#if task}
      <div class="task-icon">
        <Icon name="rocket" size={14} />
      </div>
      <div class="task-info">
        <span class="task-label">Task</span>
        <span class="task-text">{task.text}</span>
      </div>
    {/if}

    {#if activityLabel || activeToolCalls.length > 0}
      <div class="activity-slot">
        <ActivityIndicator
          compact={true}
          label={activityLabel}
          phase={activityPhase}
          tools={activeToolCalls}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .task-header {
    display: flex;
    align-items: center;
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
    flex: 1;
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
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .activity-slot {
    min-width: 220px;
    max-width: 50%;
    margin-left: auto;
  }
</style>
