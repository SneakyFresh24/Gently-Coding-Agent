<script lang="ts">
  import type { Message } from '../../lib/types';

  let {
    message,
  }: {
    message: Message;
  } = $props();

  const execution = $derived(message.toolExecution);
  const isRunning = $derived(execution?.isExecuting ?? false);

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function truncateText(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  function deriveProjectName(analysis: any): string {
    const packageName = typeof analysis?.packageJson?.name === 'string'
      ? analysis.packageJson.name.trim()
      : '';
    if (packageName) return packageName;

    const rootPath = typeof analysis?.rootPath === 'string' ? analysis.rootPath.trim() : '';
    if (!rootPath) return 'project';

    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const lastSegment = normalized.split('/').filter(Boolean).pop();
    return lastSegment || 'project';
  }

  function parseDiffStats(diff: string): { added?: number; deleted?: number } {
    const normalized = diff.trim();
    const slashFormat = normalized.match(/-\s*(\d+)\s*\/\s*\+\s*(\d+)/i);
    if (slashFormat) {
      return {
        deleted: Number(slashFormat[1]),
        added: Number(slashFormat[2]),
      };
    }

    const compactFormat = normalized.match(/\+\s*(\d+)\s*\/\s*-\s*(\d+)/i);
    if (compactFormat) {
      return {
        added: Number(compactFormat[1]),
        deleted: Number(compactFormat[2]),
      };
    }

    const plusMatch = normalized.match(/\+\s*(\d+)/i);
    const minusMatch = normalized.match(/-\s*(\d+)/i);
    return {
      added: plusMatch ? Number(plusMatch[1]) : undefined,
      deleted: minusMatch ? Number(minusMatch[1]) : undefined,
    };
  }

  function formatParsedResult(parsed: any, toolName?: string): string {
    const name = String(toolName || '').toLowerCase();
    const path = parsed?.path || parsed?.file_path || parsed?.filePath || execution?.fileName || 'file';

    if (name === 'read_file') {
      return `📄 Read ${path}`;
    }

    if (name === 'write_file') {
      if (parsed?.success === false) {
        return `❌ Failed to write ${path}`;
      }
      return `✅ Created ${path}`;
    }

    if (name.includes('edit') || name === 'apply_block_edit') {
      if (parsed?.success === false) {
        const errorMsg = String(parsed?.message || parsed?.error || 'Edit failed');
        return `❌ Edit failed in ${path}: ${truncateText(errorMsg.split('\n')[0], 80)}`;
      }

      const diffText = String(parsed?.diff || '');
      if (diffText) {
        const diff = parseDiffStats(diffText);
        if (typeof diff.added === 'number' || typeof diff.deleted === 'number') {
          const added = diff.added ?? 0;
          const deleted = diff.deleted ?? 0;
          return `✅ Edited ${path} (+${added}/-${deleted} lines)`;
        }
      }
      return `✅ Edited ${path}`;
    }

    if (name === 'regex_search') {
      const matchCount = Array.isArray(parsed?.matches) ? parsed.matches.length : 0;
      const source = parsed?.metadata?.source || 'index';
      return `🔍 Found ${matchCount} match${matchCount !== 1 ? 'es' : ''} (${source})`;
    }

    if (name.includes('find') || name.includes('search')) {
      const count = Array.isArray(parsed?.results)
        ? parsed.results.length
        : (Array.isArray(parsed?.matches) ? parsed.matches.length : 0);
      return `🔍 Found ${count} result${count !== 1 ? 's' : ''}`;
    }

    if (name === 'list_files') {
      return '📁 Listed files';
    }

    if (name === 'run_command') {
      if (parsed?.success === false) {
        return '❌ Command failed';
      }
      return '⚡ Command executed';
    }

    if (name === 'analyze_project_structure') {
      const analysis = parsed?.analysis || {};
      const projectName = deriveProjectName(analysis);
      const projectType = String(analysis?.framework || analysis?.projectType || 'unknown');
      return `📊 Analyzed ${projectName} (${projectType})`;
    }

    if (name === 'create_plan') {
      const steps = Array.isArray(parsed?.plan?.steps)
        ? parsed.plan.steps
        : (Array.isArray(parsed?.steps) ? parsed.steps : []);
      return `📋 Plan created (${steps.length} steps)`;
    }

    if (name === 'ask_question') {
      const selected = Array.isArray(parsed?.answer)
        ? parsed.answer
        : (typeof parsed?.answer === 'string' && parsed.answer.trim() !== '' ? [parsed.answer] : []);
      if (selected.length > 0) {
        return `❓ User selected: ${selected.join(', ')}`;
      }

      const msg = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
      if (msg) {
        const cleaned = msg.replace(/^User selected:\s*/i, '').trim();
        return `❓ User selected: ${truncateText(cleaned || msg, 120)}`;
      }
      return '❓ User selected: (none)';
    }

    if (name.includes('memory') || name === 'remember' || name === 'recall_memories') {
      if (name.includes('recall')) {
        const count = Array.isArray(parsed?.memories)
          ? parsed.memories.length
          : (Array.isArray(parsed?.results) ? parsed.results.length : 0);
        return `🧠 Recalled ${count} memor${count !== 1 ? 'ies' : 'y'}`;
      }
      return parsed?.success === false ? '❌ Memory failed' : '💾 Memory saved';
    }

    if (typeof parsed?.message === 'string' && parsed.message.trim() !== '') {
      return truncateText(parsed.message, 200);
    }

    return truncateText(JSON.stringify(parsed), 120);
  }

  function formatToolResult(content: string, toolName?: string): string {
    if (!content) return '';
    try {
      const parsed = JSON.parse(content);
      return formatParsedResult(parsed, toolName);
    } catch {
      if (content.includes('error') || content.includes('Error')) {
        return `❌ ${truncateText(content, 100)}`;
      }
      return `📋 ${truncateText(content, 50)}`;
    }
  }

  const resolvedToolName = $derived(message.toolName || execution?.toolName || 'Tool');
  const displayText = $derived(formatToolResult(message.content || '', resolvedToolName));
</script>

<div class="tool-message" class:running={isRunning}>
  <div class="tool-header">
    <span class="tool-icon">{isRunning ? '⚙️' : '✅'}</span>
    <span class="tool-name">{resolvedToolName}</span>
    {#if execution?.duration}
      <span class="tool-duration">{formatDuration(execution.duration)}</span>
    {/if}
  </div>

  {#if execution?.fileName}
    <div class="tool-detail">
      <span class="detail-label">File:</span>
      <span class="detail-value">{execution.fileName}</span>
    </div>
  {/if}

  {#if execution?.diffStats}
    <div class="tool-diff">
      <span class="diff-added">+{execution.diffStats.added}</span>
      <span class="diff-deleted">-{execution.diffStats.deleted}</span>
    </div>
  {/if}

  {#if displayText}
    <div class="tool-content">{displayText}</div>
  {/if}
</div>

<style>
  .tool-message {
    border-left: 3px solid var(--vscode-textLink-foreground);
    padding: var(--space-md) var(--space-lg);
    background: var(--vscode-editor-background);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    font-size: var(--font-size-xs);
  }

  .tool-message.running {
    border-left-color: var(--vscode-progressBar-background, #0078d4);
  }

  .tool-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-bottom: var(--space-xs);
  }

  .tool-icon {
    font-size: var(--font-size-sm);
  }

  .tool-name {
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .tool-duration {
    color: var(--vscode-descriptionForeground);
    margin-left: auto;
  }

  .tool-detail {
    color: var(--vscode-descriptionForeground);
    margin-top: var(--space-xs);
  }

  .detail-label {
    opacity: 0.7;
  }

  .detail-value {
    color: var(--vscode-textLink-foreground);
  }

  .tool-diff {
    display: flex;
    gap: var(--space-md);
    margin-top: var(--space-xs);
  }

  .diff-added {
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .diff-deleted {
    color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39);
  }

  .tool-content {
    margin-top: var(--space-sm);
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
  }
</style>
