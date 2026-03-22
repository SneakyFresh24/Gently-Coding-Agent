<script lang="ts">
  import type { ToolCallInfo } from '../../lib/types';

  let {
    tools = [],
    compact = false,
  }: {
    tools?: ToolCallInfo[];
    compact?: boolean;
  } = $props();

  const LOW_STAKES = new Set(['read_file', 'list_files', 'find_files', 'search_codebase', 'get_context', 'analyze_project_structure']);

  const lowStakes = $derived(tools.filter((t) => LOW_STAKES.has(t.toolName)));
  const higherStakes = $derived(tools.filter((t) => !LOW_STAKES.has(t.toolName)));

  function toolIcon(name: string): string {
    if (name.includes('read') || name.includes('list') || name.includes('find') || name.includes('search')) return '🔍';
    if (name.includes('write') || name.includes('edit') || name.includes('apply')) return '✍️';
    if (name.includes('run') || name.includes('command')) return '⚙️';
    return '🧰';
  }

  function groupedLabel(items: ToolCallInfo[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return `${items[0].toolName}${items[0].file ? ` ${items[0].file}` : ''}`;
    return `${items.length} low-stakes tools running`;
  }
</script>

{#if tools.length > 0}
  <div class="tool-badges" class:compact>
    {#if lowStakes.length > 0}
      <div class="badge grouped" title={groupedLabel(lowStakes)}>
        <span class="icon">🔎</span>
        <span>{groupedLabel(lowStakes)}</span>
      </div>
    {/if}

    {#each higherStakes as tool (tool.toolId)}
      <div class="badge" title={tool.file || tool.toolName}>
        <span class="icon">{toolIcon(tool.toolName)}</span>
        <span class="name">{tool.toolName}</span>
        {#if tool.file}
          <span class="file">{tool.file}</span>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .tool-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tool-badges.compact .badge {
    padding: 2px 6px;
    font-size: 10px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 999px;
    background: var(--vscode-editor-background);
    color: var(--vscode-descriptionForeground);
    font-size: 11px;
  }

  .badge.grouped {
    color: var(--vscode-textLink-foreground);
    border-color: color-mix(in srgb, var(--vscode-textLink-foreground) 35%, transparent);
  }

  .icon {
    opacity: 0.85;
  }

  .name {
    color: var(--vscode-foreground);
  }

  .file {
    opacity: 0.8;
  }
</style>

