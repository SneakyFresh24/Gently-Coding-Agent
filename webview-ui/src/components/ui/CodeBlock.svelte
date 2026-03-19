<script lang="ts">
  import hljs from 'highlight.js';

  let {
    code = '',
    language = '',
    filename = '',
  }: {
    code?: string;
    language?: string;
    filename?: string;
  } = $props();

  let copied = $state(false);

  function getHighlightedHtml(): string {
    if (!code) return '';
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }

  function escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Clipboard API may not be available in webview
    }
  }
</script>

<div class="code-block">
  {#if filename || language}
    <div class="code-header">
      <span class="code-lang">{filename || language}</span>
      <button class="copy-btn" onclick={copyCode} title="Copy code">
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  {:else}
    <button class="copy-btn floating" onclick={copyCode} title="Copy code">
      {copied ? '✓' : '⎘'}
    </button>
  {/if}
  <pre><code class="hljs">{@html getHighlightedHtml()}</code></pre>
</div>

<style>
  .code-block {
    position: relative;
    border-radius: var(--radius-md);
    overflow: hidden;
    margin: var(--space-md) 0;
    border: 1px solid var(--vscode-panel-border);
  }

  .code-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-xs) var(--space-lg);
    background: var(--vscode-editorGroupHeader-tabsBackground, rgba(127, 127, 127, 0.08));
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: var(--font-size-xs);
  }

  .code-lang {
    color: var(--vscode-descriptionForeground);
    text-transform: lowercase;
  }

  .copy-btn {
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: var(--font-size-xs);
    padding: var(--space-xxs) var(--space-sm);
    border-radius: var(--radius-sm);
  }

  .copy-btn:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.12));
    color: var(--vscode-foreground);
  }

  .copy-btn.floating {
    position: absolute;
    top: var(--space-sm);
    right: var(--space-sm);
    z-index: 1;
    opacity: 0;
    transition: opacity var(--transition-normal);
  }

  .code-block:hover .copy-btn.floating {
    opacity: 1;
  }

  pre {
    margin: 0;
    padding: var(--space-lg);
    overflow-x: auto;
    background: var(--vscode-editor-background);
  }

  code.hljs {
    background: transparent;
    padding: 0;
  }
</style>
