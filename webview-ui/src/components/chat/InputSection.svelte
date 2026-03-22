<script lang="ts">
  import Button from '../ui/Button.svelte';
  import FileReferenceChip from '../context/FileReference.svelte';
  import ActivityIndicator from './ActivityIndicator.svelte';
  import type { ToolCallInfo } from '../../lib/types';

  let {
    isBusy = false,
    isStreamingProp = false,
    hasModel = true,
    inputValue = '',
    selectedFiles = [] as string[],
    activityLabel = null as string | null,
    activityPhase = 'idle' as 'idle' | 'sending' | 'thinking' | 'tooling',
    activeToolCalls = [] as ToolCallInfo[],
    onInputChange,
    onSend,
    onCancel,
    onAddFile,
    onRemoveFile,
  }: {
    isBusy?: boolean;
    isStreamingProp?: boolean;
    hasModel?: boolean;
    inputValue?: string;
    selectedFiles?: string[];
    activityLabel?: string | null;
    activityPhase?: 'idle' | 'sending' | 'thinking' | 'tooling';
    activeToolCalls?: ToolCallInfo[];
    onInputChange?: (value: string) => void;
    onSend?: () => void;
    onCancel?: () => void;
    onAddFile?: (path: string) => void;
    onRemoveFile?: (path: string) => void;
  } = $props();

  let textareaRef: HTMLTextAreaElement | undefined = $state();

  function handleKeydown(e: KeyboardEvent) {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isBusy && hasModel && inputValue.trim()) {
        onSend?.();
      }
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    onInputChange?.(target.value);
    autoResize(target);
  }

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function handleAddFileClick() {
    // Triggers VS Code file picker via messaging
    import('../../lib/messaging').then(({ send }) => {
      send('openFilePicker');
    });
  }
</script>

<div class="input-section">
  {#if activityLabel || activeToolCalls.length > 0}
    <div class="activity-wrap">
      <ActivityIndicator
        label={activityLabel}
        phase={activityPhase}
        tools={activeToolCalls}
      />
    </div>
  {/if}

  {#if selectedFiles.length > 0}
    <div class="file-chips">
      {#each selectedFiles as file}
        <FileReferenceChip
          path={file}
          onRemove={() => onRemoveFile?.(file)}
        />
      {/each}
    </div>
  {/if}
  {#if !hasModel}
    <div class="model-warning">Select an OpenRouter model before sending a message.</div>
  {/if}

  <div class="input-row" class:active={isBusy || isStreamingProp}>
    <textarea
      bind:this={textareaRef}
      class="input-textarea"
      placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
      value={inputValue}
      oninput={handleInput}
      onkeydown={handleKeydown}
      rows="1"
      disabled={isBusy}
    ></textarea>

    <div class="input-actions">
      <button
        class="icon-btn"
        onclick={handleAddFileClick}
        title="Attach file"
        disabled={isBusy}
      >
        📎
      </button>

      {#if isBusy || isStreamingProp}
        <Button variant="danger" size="sm" onclick={onCancel}>
          Stop
        </Button>
      {:else}
        <Button
          variant="primary"
          size="sm"
          disabled={!inputValue.trim() || !hasModel}
          onclick={onSend}
        >
          Send
        </Button>
      {/if}
    </div>
  </div>
</div>

<style>
  .input-section {
    padding: var(--space-md) var(--space-lg);
  }

  .activity-wrap {
    margin-bottom: var(--space-sm);
  }

  .file-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    padding-bottom: var(--space-md);
  }

  .input-row {
    display: flex;
    align-items: flex-end;
    gap: var(--space-md);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    border-radius: var(--radius-lg);
    padding: var(--space-sm) var(--space-md);
  }

  .model-warning {
    font-size: var(--font-size-xs);
    color: var(--vscode-descriptionForeground);
    margin-bottom: var(--space-sm);
  }

  .input-row:focus-within {
    border-color: var(--vscode-focusBorder);
  }

  .input-row.active {
    border-color: color-mix(in srgb, var(--vscode-progressBar-background) 55%, var(--vscode-panel-border));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-progressBar-background) 20%, transparent) inset;
  }

  .input-textarea {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--vscode-input-foreground, var(--vscode-foreground));
    font-family: inherit;
    font-size: var(--font-size-md);
    line-height: var(--line-height-normal);
    resize: none;
    outline: none;
    padding: var(--space-xs) 0;
    min-height: 24px;
    max-height: 200px;
  }

  .input-textarea::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }

  .input-textarea:disabled {
    opacity: 0.5;
  }

  .input-actions {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  .icon-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: var(--font-size-lg);
    padding: var(--space-xs);
    border-radius: var(--radius-sm);
    opacity: 0.6;
    line-height: 1;
  }

  .icon-btn:hover:not(:disabled) {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.12));
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
