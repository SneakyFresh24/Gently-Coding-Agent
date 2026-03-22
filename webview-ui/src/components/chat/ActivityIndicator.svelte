<script lang="ts">
  import { onDestroy } from 'svelte';
  import TypewriterText from './TypewriterText.svelte';
  import ToolExecutionBadge from './ToolExecutionBadge.svelte';
  import type { ToolCallInfo } from '../../lib/types';

  let {
    label = null,
    phase = 'idle',
    tools = [],
    compact = false,
  }: {
    label?: string | null;
    phase?: 'idle' | 'sending' | 'thinking' | 'tooling';
    tools?: ToolCallInfo[];
    compact?: boolean;
  } = $props();

  const MIN_LABEL_MS = 300;
  let displayedLabel = $state<string | null>(null);
  let lastLabel = '';
  let lastChange = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearDebounce() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  function applyLabel(next: string | null) {
    const normalized = next || null;
    const incoming = normalized || '';
    if (incoming === lastLabel) return;

    const now = Date.now();
    const elapsed = now - lastChange;
    clearDebounce();
    if (lastLabel && elapsed < MIN_LABEL_MS) {
      debounceTimer = setTimeout(() => {
        displayedLabel = normalized;
        lastLabel = incoming;
        lastChange = Date.now();
      }, MIN_LABEL_MS - elapsed);
      return;
    }

    displayedLabel = normalized;
    lastLabel = incoming;
    lastChange = now;
  }

  $effect(() => {
    applyLabel(label);
  });

  onDestroy(() => {
    clearDebounce();
  });

  const useTypewriter = $derived(Boolean(displayedLabel && /(reading|search|list|preparing|scann|analys)/i.test(displayedLabel)));
  const isThinking = $derived(phase === 'thinking' || /(thinking|denkt|analyzing)/i.test(displayedLabel || ''));
</script>

{#if displayedLabel || tools.length > 0}
  <div
    class="activity-indicator"
    class:compact
    class:thinking={isThinking}
    role="status"
    aria-live="polite"
    aria-label={displayedLabel || 'Ready'}
  >
    {#if displayedLabel}
      <div class="label">
        <span class="dot" aria-hidden="true"></span>
        {#if useTypewriter}
          <TypewriterText text={displayedLabel} speed={15} enabled={true} />
        {:else}
          <span class:shimmer={isThinking}>{displayedLabel}</span>
        {/if}
      </div>
    {/if}

    <ToolExecutionBadge tools={tools} {compact} />
  </div>
{/if}

<style>
  .activity-indicator {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--vscode-editor-background) 80%, transparent);
    border: 1px solid var(--vscode-widget-border);
  }

  .activity-indicator.compact {
    padding: 4px 8px;
    gap: 4px;
  }

  .label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .activity-indicator.compact .label {
    font-size: 11px;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--vscode-progressBar-background);
    animation: pulse 1.2s infinite ease-in-out;
  }

  .thinking .dot {
    background: #d9a441;
  }

  .shimmer {
    background: linear-gradient(90deg, var(--vscode-descriptionForeground) 0%, var(--vscode-foreground) 50%, var(--vscode-descriptionForeground) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    background-size: 200% 100%;
    animation: shimmer 1.5s linear infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1); }
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
</style>

