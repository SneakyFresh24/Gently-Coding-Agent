<script lang="ts">
  import Button from '../ui/Button.svelte';
  import FileReferenceChip from '../context/FileReference.svelte';

  let {
    isBusy = false,
    isStreamingProp = false,
    inputValue = '',
    selectedFiles = [] as string[],
    onInputChange,
    onSend,
    onCancel,
    onAddFile,
    onRemoveFile,
  }: {
    isBusy?: boolean;
    isStreamingProp?: boolean;
    inputValue?: string;
    selectedFiles?: string[];
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
      if (!isBusy && inputValue.trim()) {
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

  <div class="input-row">
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
          disabled={!inputValue.trim()}
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

  .input-row:focus-within {
    border-color: var(--vscode-focusBorder);
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
