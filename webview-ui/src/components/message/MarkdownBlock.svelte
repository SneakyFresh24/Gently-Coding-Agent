<script lang="ts">
  import { marked } from 'marked';
  import CodeBlock from '../ui/CodeBlock.svelte';

  let {
    content = '',
  }: {
    content?: string;
  } = $props();

  interface ParsedBlock {
    type: 'html' | 'code';
    content: string;
    language?: string;
    filename?: string;
  }

  function parseContent(): ParsedBlock[] {
    if (!content) return [];

    const blocks: ParsedBlock[] = [];
    // Split by code fences
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Text before code block
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index);
        if (text.trim()) {
          blocks.push({
            type: 'html',
            content: marked.parse(text, { async: false }) as string,
          });
        }
      }

      // Code block
      blocks.push({
        type: 'code',
        language: match[1] || '',
        content: match[2].trimEnd(),
      });

      lastIndex = match.index + match[0].length;
    }

    // Remaining text
    if (lastIndex < content.length) {
      const text = content.slice(lastIndex);
      if (text.trim()) {
        blocks.push({
          type: 'html',
          content: marked.parse(text, { async: false }) as string,
        });
      }
    }

    // If no code blocks found, parse entire content as markdown
    if (blocks.length === 0 && content.trim()) {
      blocks.push({
        type: 'html',
        content: marked.parse(content, { async: false }) as string,
      });
    }

    return blocks;
  }
</script>

<div class="markdown-block">
  {#each parseContent() as block}
    {#if block.type === 'code'}
      <CodeBlock code={block.content} language={block.language} />
    {:else}
      {@html block.content}
    {/if}
  {/each}
</div>

<style>
  .markdown-block {
    font-size: var(--font-size-sm);
    line-height: var(--line-height-relaxed);
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .markdown-block :global(p) {
    margin-bottom: var(--space-md);
  }

  .markdown-block :global(p:last-child) {
    margin-bottom: 0;
  }

  .markdown-block :global(ul),
  .markdown-block :global(ol) {
    padding-left: var(--space-2xl);
    margin-bottom: var(--space-md);
  }

  .markdown-block :global(li) {
    margin-bottom: var(--space-xs);
  }

  .markdown-block :global(h1),
  .markdown-block :global(h2),
  .markdown-block :global(h3),
  .markdown-block :global(h4) {
    margin-top: var(--space-xl);
    margin-bottom: var(--space-md);
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .markdown-block :global(h1) { font-size: var(--font-size-xl); }
  .markdown-block :global(h2) { font-size: var(--font-size-lg); }
  .markdown-block :global(h3) { font-size: var(--font-size-md); }

  .markdown-block :global(blockquote) {
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
    padding-left: var(--space-lg);
    margin: var(--space-md) 0;
    color: var(--vscode-descriptionForeground);
  }

  .markdown-block :global(hr) {
    border: none;
    border-top: 1px solid var(--vscode-panel-border);
    margin: var(--space-xl) 0;
  }

  .markdown-block :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: var(--space-md) 0;
    font-size: var(--font-size-xs);
  }

  .markdown-block :global(th),
  .markdown-block :global(td) {
    border: 1px solid var(--vscode-panel-border);
    padding: var(--space-sm) var(--space-md);
    text-align: left;
  }

  .markdown-block :global(th) {
    background: var(--vscode-editorGroupHeader-tabsBackground, rgba(127, 127, 127, 0.08));
    font-weight: 600;
  }

  .markdown-block :global(strong) {
    font-weight: 600;
  }

  .markdown-block :global(em) {
    font-style: italic;
  }

  .markdown-block :global(img) {
    max-width: 100%;
    border-radius: var(--radius-md);
  }
</style>
