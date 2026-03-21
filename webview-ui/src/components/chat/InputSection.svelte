<script lang="ts">
  import Button from '../ui/Button.svelte';
  import FileReferenceChip from '../context/FileReference.svelte';
  import { messaging } from '../../lib/messaging';

  let {
    isBusy = false,
    isStreamingProp = false,
    hasModel = true,
    inputValue = '',
    selectedFiles = [] as string[],
    mentionState = {
      isOpen: false,
      query: '',
      results: [] as Array<{ path: string; displayName?: string; type?: 'file' | 'folder' }>,
      activeIndex: 0,
      atIndex: -1,
      cursorPosition: 0,
    },
    onInputChange,
    onSend,
    onCancel,
    onAddFile,
    onRemoveFile,
    onMentionContextChange,
    onCloseMention,
  }: {
    isBusy?: boolean;
    isStreamingProp?: boolean;
    hasModel?: boolean;
    inputValue?: string;
    selectedFiles?: string[];
    mentionState?: {
      isOpen: boolean;
      query: string;
      results: Array<{ path: string; displayName?: string; type?: 'file' | 'folder' }>;
      activeIndex: number;
      atIndex: number;
      cursorPosition: number;
    };
    onInputChange?: (value: string) => void;
    onSend?: () => void;
    onCancel?: () => void;
    onAddFile?: (path: string) => void;
    onRemoveFile?: (path: string) => void;
    onMentionContextChange?: (atIndex: number, cursorPosition: number, query: string) => void;
    onCloseMention?: () => void;
  } = $props();

  let textareaRef: HTMLTextAreaElement | undefined = $state();
  let activeMentionIndex = $state(0);
  let mentionSearchDebounce: ReturnType<typeof setTimeout> | null = null;
  let isSlashOpen = $state(false);
  let slashQuery = $state('');
  let activeSlashIndex = $state(0);

  const slashCommands = [
    { key: '/explain', description: 'Explain selected code or context.' },
    { key: '/fix', description: 'Suggest and apply a concrete fix.' },
    { key: '/test', description: 'Create or improve tests.' },
    { key: '/review', description: 'Run a quick review with risks first.' },
  ];

  $effect(() => {
    autoResize(textareaRef);
  });

  $effect(() => {
    if (!mentionState.isOpen) {
      activeMentionIndex = 0;
      return;
    }
    activeMentionIndex = Math.min(activeMentionIndex, Math.max(mentionState.results.length - 1, 0));
  });

  function handleKeydown(e: KeyboardEvent) {
    if (mentionState.isOpen && mentionState.results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeMentionIndex = (activeMentionIndex + 1) % mentionState.results.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeMentionIndex = (activeMentionIndex - 1 + mentionState.results.length) % mentionState.results.length;
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault();
        insertMention(mentionState.results[activeMentionIndex]);
        return;
      }
    }

    if (isSlashOpen) {
      const commands = filteredSlashCommands();
      if (commands.length > 0 && e.key === 'ArrowDown') {
        e.preventDefault();
        activeSlashIndex = (activeSlashIndex + 1) % commands.length;
        return;
      }
      if (commands.length > 0 && e.key === 'ArrowUp') {
        e.preventDefault();
        activeSlashIndex = (activeSlashIndex - 1 + commands.length) % commands.length;
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        isSlashOpen = false;
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && commands.length > 0) {
        e.preventDefault();
        insertSlash(commands[activeSlashIndex]);
        return;
      }
    }

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
    const value = target.value;
    onInputChange?.(value);
    autoResize(target);
    updateMentionState(value, target.selectionStart || value.length);
    updateSlashState(value, target.selectionStart || value.length);
  }

  function autoResize(el: HTMLTextAreaElement | undefined) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function handleAddFileClick() {
    messaging.send('openFilePicker');
  }

  function updateMentionState(value: string, cursorPosition: number) {
    const beforeCursor = value.slice(0, cursorPosition);
    const lastAt = beforeCursor.lastIndexOf('@');
    if (lastAt === -1) {
      closeMention();
      return;
    }

    const prefix = beforeCursor.slice(lastAt - 1, lastAt);
    const isWordPrefix = prefix && !/\s/.test(prefix);
    if (isWordPrefix) {
      closeMention();
      return;
    }

    const query = beforeCursor.slice(lastAt + 1);
    if (/\s/.test(query)) {
      closeMention();
      return;
    }

    if (mentionSearchDebounce) clearTimeout(mentionSearchDebounce);
    mentionSearchDebounce = setTimeout(() => {
      onMentionContextChange?.(lastAt, cursorPosition, query);
      messaging.send('searchFiles', { query });
    }, 120);
  }

  function closeMention() {
    onCloseMention?.();
  }

  function insertMention(item: { path: string; displayName?: string }) {
    if (!textareaRef) return;
    const cursorPosition = textareaRef.selectionStart || inputValue.length;
    const beforeCursor = inputValue.slice(0, cursorPosition);
    const afterCursor = inputValue.slice(cursorPosition);
    const atIndex = beforeCursor.lastIndexOf('@');
    if (atIndex === -1) return;

    const mentionText = `@${item.path} `;
    const nextValue = `${beforeCursor.slice(0, atIndex)}${mentionText}${afterCursor}`;
    onInputChange?.(nextValue);
    closeMention();

    requestAnimationFrame(() => {
      if (!textareaRef) return;
      const nextPosition = atIndex + mentionText.length;
      textareaRef.selectionStart = nextPosition;
      textareaRef.selectionEnd = nextPosition;
      textareaRef.focus();
    });
  }

  function filteredSlashCommands() {
    if (!slashQuery.trim()) return slashCommands;
    return slashCommands.filter((cmd) => cmd.key.toLowerCase().includes(slashQuery.toLowerCase()));
  }

  function updateSlashState(value: string, cursorPosition: number) {
    const beforeCursor = value.slice(0, cursorPosition);
    const slashIndex = beforeCursor.lastIndexOf('/');
    if (slashIndex === -1) {
      isSlashOpen = false;
      return;
    }

    const prefix = beforeCursor.slice(slashIndex - 1, slashIndex);
    if (prefix && !/\s/.test(prefix)) {
      isSlashOpen = false;
      return;
    }

    const query = beforeCursor.slice(slashIndex);
    if (query.includes('\n')) {
      isSlashOpen = false;
      return;
    }

    slashQuery = query;
    isSlashOpen = true;
    activeSlashIndex = 0;
  }

  function insertSlash(command: { key: string }) {
    if (!textareaRef) return;
    const cursorPosition = textareaRef.selectionStart || inputValue.length;
    const beforeCursor = inputValue.slice(0, cursorPosition);
    const afterCursor = inputValue.slice(cursorPosition);
    const slashIndex = beforeCursor.lastIndexOf('/');
    if (slashIndex === -1) return;

    const nextValue = `${beforeCursor.slice(0, slashIndex)}${command.key} ${afterCursor}`;
    onInputChange?.(nextValue);
    isSlashOpen = false;

    requestAnimationFrame(() => {
      if (!textareaRef) return;
      const nextPosition = slashIndex + command.key.length + 1;
      textareaRef.selectionStart = nextPosition;
      textareaRef.selectionEnd = nextPosition;
      textareaRef.focus();
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
  {#if !hasModel}
    <div class="model-warning">Select an OpenRouter model before sending a message.</div>
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
      aria-label="Chat input"
    ></textarea>

    {#if mentionState.isOpen && mentionState.results.length > 0}
      <div class="suggestion-menu mention-menu" role="listbox" aria-label="File mentions">
        {#each mentionState.results as item, index (`mention-${item.path}-${index}`)}
          <button
            class="suggestion-item"
            class:active={index === activeMentionIndex}
            onclick={() => insertMention(item)}
            aria-label={`Mention ${item.displayName || item.path}`}
          >
            <span class="item-title">{item.displayName || item.path}</span>
            <span class="item-path">{item.path}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if isSlashOpen}
      <div class="suggestion-menu slash-menu" role="listbox" aria-label="Slash commands">
        {#each filteredSlashCommands() as command, index (`slash-${command.key}`)}
          <button
            class="suggestion-item"
            class:active={index === activeSlashIndex}
            onclick={() => insertSlash(command)}
            aria-label={`Insert command ${command.key}`}
          >
            <span class="item-title">{command.key}</span>
            <span class="item-path">{command.description}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="input-actions">
      <button
        class="icon-btn"
        onclick={handleAddFileClick}
        title="Attach file"
        disabled={isBusy}
        aria-label="Attach file"
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

  .file-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    padding-bottom: var(--space-md);
  }

  .input-row {
    position: relative;
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

  .suggestion-menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    max-height: 220px;
    overflow-y: auto;
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: var(--radius-md);
    background: var(--vscode-dropdown-background);
    box-shadow: var(--shadow-lg);
    z-index: 40;
    padding: 4px;
  }

  .suggestion-item {
    width: 100%;
    border: none;
    background: transparent;
    color: var(--vscode-dropdown-foreground);
    text-align: left;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: pointer;
  }

  .suggestion-item:hover,
  .suggestion-item.active {
    background: var(--vscode-list-hoverBackground);
  }

  .item-title {
    font-size: var(--font-size-xs);
    font-weight: 600;
  }

  .item-path {
    font-size: var(--font-size-xxs);
    color: var(--vscode-descriptionForeground);
  }
</style>
