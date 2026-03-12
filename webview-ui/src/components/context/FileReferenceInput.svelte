<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { extensionSync } from "../../lib/extensionSync";
  import { File, X, Folder } from "lucide-svelte";
  import type { FileReference } from "../../stores/chatStore";

  interface Props {
    value: string;
    disabled?: boolean;
    placeholder?: string;
    externalFileReferences?: FileReference[];
    onsend?: (data: {
      message: string;
      fileReferences: FileReference[];
    }) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  }

  let {
    value = $bindable(""),
    disabled = false,
    placeholder = "Type your message...",
    externalFileReferences = $bindable([]),
    onsend,
    onkeydown,
  }: Props = $props();

  let textareaElement = $state<HTMLTextAreaElement | null>(null);
  let fileReferences = $state<FileReference[]>([]);

  // Watch for external file references and merge them
  $effect(() => {
    if (externalFileReferences.length > 0) {
      const newRefs = externalFileReferences.filter(
        (extRef) => !fileReferences.some((ref) => ref.path === extRef.path),
      );
      if (newRefs.length > 0) {
        fileReferences = [...fileReferences, ...newRefs];
      }
    }
  });

  let autocompleteResults = $state<any[]>([]);
  let showAutocomplete = $state(false);
  let selectedIndex = $state(0);
  let cursorPosition = $state(0);
  let atSymbolPosition = $state(-1);

  // Handle input changes
  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    value = target.value;
    cursorPosition = target.selectionStart;

    // Check for @ symbol
    checkForAtSymbol();
  }

  // Check if user typed @ for autocomplete
  function checkForAtSymbol() {
    const textBeforeCursor = value.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);

      // Only show autocomplete if @ is at start or after whitespace
      const charBeforeAt =
        lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : " ";
      if (charBeforeAt === " " || charBeforeAt === "\n" || lastAtIndex === 0) {
        atSymbolPosition = lastAtIndex;
        searchFiles(textAfterAt);
      } else {
        hideAutocomplete();
      }
    } else {
      hideAutocomplete();
    }
  }

  // Search files via backend
  function searchFiles(query: string) {
    extensionSync.send("searchFiles", { query });
  }

  // Hide autocomplete
  function hideAutocomplete() {
    showAutocomplete = false;
    autocompleteResults = [];
    selectedIndex = 0;
    atSymbolPosition = -1;
  }

  // Handle keyboard navigation
  function handleKeyDown(event: KeyboardEvent) {
    // Autocomplete navigation
    if (showAutocomplete) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedIndex = Math.min(
          selectedIndex + 1,
          autocompleteResults.length - 1,
        );
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (autocompleteResults.length > 0) {
          selectFile(autocompleteResults[selectedIndex]);
        }
        return;
      } else if (event.key === "Escape") {
        event.preventDefault();
        hideAutocomplete();
        return;
      }
    }

    // Send message on Enter (without Shift)
    if (event.key === "Enter" && !event.shiftKey && !showAutocomplete) {
      event.preventDefault();
      sendMessage();
      return;
    }

    // Forward other keydown events
    if (onkeydown) onkeydown(event);
  }

  // Select file from autocomplete
  function selectFile(file: any) {
    // Remove @query from text (don't replace with @filepath, we use pills instead)
    const textBeforeAt = value.substring(0, atSymbolPosition);
    const textAfterCursor = value.substring(cursorPosition);
    value = (textBeforeAt + " " + textAfterCursor).trim();

    // Add to file references as pill
    fileReferences = [
      ...fileReferences,
      {
        path: file.path,
        displayName: file.name || file.path.split("/").pop() || file.path,
        size: file.size,
        language: file.language,
      },
    ];

    hideAutocomplete();
    textareaElement?.focus();
  }

  // Remove file reference
  function removeFile(index: number) {
    fileReferences = fileReferences.filter((_, i) => i !== index);
  }

  // Send message
  function sendMessage() {
    if (!value.trim() || disabled) return;

    if (onsend) {
      onsend({
        message: value.trim(),
        fileReferences: [...fileReferences],
      });
    }

    // Clear input and references
    value = "";
    fileReferences = [];
  }

  // Format file size
  function formatSize(bytes: number | undefined): string {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  // Get file icon
  function getFileIcon(path: string) {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "📘";
      case "js":
      case "jsx":
        return "Orange";
      case "py":
        return "🐍";
      case "json":
        return "📋";
      case "md":
        return "📝";
      default:
        return "📄";
    }
  }

  onMount(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "fileSearchResults") {
        autocompleteResults = message.results || [];
        showAutocomplete = autocompleteResults.length > 0;
        selectedIndex = 0;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  });
</script>

<div class="file-reference-input">
  <!-- File Pills -->
  {#if fileReferences.length > 0}
    <div class="file-pills">
      {#each fileReferences as file, index}
        <div class="file-pill animate-scale-in">
          <span class="pill-icon">{getFileIcon(file.path)}</span>
          <span class="pill-name">{file.displayName}</span>
          {#if file.size}
            <span class="pill-size">{formatSize(file.size)}</span>
          {/if}
          <button
            class="pill-remove"
            onclick={() => removeFile(index)}
            title="Remove file"
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Textarea -->
  <div class="input-wrapper">
    <textarea
      bind:this={textareaElement}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeyDown}
      {placeholder}
      {disabled}
      rows="3"
      class="message-input"
    ></textarea>

    <!-- Autocomplete Dropdown -->
    {#if showAutocomplete}
      <div class="autocomplete-dropdown animate-fade-in">
        {#each autocompleteResults as result, index}
          <button
            class="autocomplete-item"
            class:selected={index === selectedIndex}
            onclick={() => selectFile(result)}
            type="button"
          >
            <span class="item-icon">
              {#if result.type === "folder"}
                <Folder size={16} />
              {:else}
                <File size={16} />
              {/if}
            </span>
            <div class="item-info">
              <div class="item-name">
                {result.name || result.path.split("/").pop()}
              </div>
              <div class="item-path">{result.path}</div>
            </div>
            {#if result.size}
              <span class="item-size">{formatSize(result.size)}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .file-reference-input {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* File Pills */
  .file-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .file-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 0.5rem;
    font-size: 0.8125rem;
    transition: all 0.2s ease;
  }

  .file-pill:hover {
    background: rgba(59, 130, 246, 0.25);
    border-color: rgba(59, 130, 246, 0.5);
    transform: translateY(-1px);
  }

  .pill-icon {
    font-size: 0.875rem;
  }

  .pill-name {
    font-weight: 500;
    color: rgb(147, 197, 253);
  }

  .pill-size {
    opacity: 0.7;
    font-size: 0.75rem;
  }

  .pill-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.125rem;
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
    transition: opacity 0.2s ease;
  }

  .pill-remove:hover {
    opacity: 1;
  }

  /* Input Wrapper */
  .input-wrapper {
    position: relative;
  }

  .message-input {
    width: 100%;
    padding: 0.875rem 1rem;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    color: inherit;
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    resize: none;
    transition: all 0.2s ease;
    min-height: 44px;
    max-height: 200px;
  }

  .message-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.5);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .message-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Autocomplete Dropdown */
  .autocomplete-dropdown {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 0.5rem;
    max-height: 300px;
    overflow-y: auto;
    background: rgba(30, 30, 30, 0.95);
    backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.75rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    z-index: 1000;
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s ease;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .autocomplete-item:last-child {
    border-bottom: none;
  }

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: rgba(59, 130, 246, 0.15);
  }

  .item-icon {
    display: flex;
    color: rgb(147, 197, 253);
  }

  .item-info {
    flex: 1;
    min-width: 0;
  }

  .item-name {
    font-weight: 500;
    font-size: 0.875rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-path {
    font-size: 0.75rem;
    opacity: 0.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-size {
    font-size: 0.75rem;
    opacity: 0.6;
  }
</style>
