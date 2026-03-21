<script lang="ts">
  import type { Message } from '../../lib/types';
  import MessageRow from './MessageRow.svelte';
  import { onMount, tick } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  let {
    messages = [],
  }: {
    messages?: Message[];
  } = $props();

  let containerRef: HTMLDivElement | undefined = $state();
  let autoScroll = true;
  const VIRTUAL_ROW_ESTIMATE = 104;

  const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => VIRTUAL_ROW_ESTIMATE,
    overscan: 8,
  });

  function handleScroll() {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    // Consider "at bottom" if within 60px
    autoScroll = scrollHeight - scrollTop - clientHeight < 60;
  }

  async function scrollToBottom() {
    if (!autoScroll || !containerRef || messages.length === 0) return;
    await tick();
    $rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end' });
  }

  $effect(() => {
    messages.length;
    $rowVirtualizer.setOptions({
      count: messages.length,
      getScrollElement: () => containerRef ?? null,
      estimateSize: () => VIRTUAL_ROW_ESTIMATE,
      overscan: 8,
    });
  });

  // Scroll when messages change
  $effect(() => {
    messages; // dependency
    scrollToBottom();
  });

  onMount(() => {
    scrollToBottom();
  });
</script>

<div
  class="messages-area scrollable"
  bind:this={containerRef}
  onscroll={handleScroll}
>
  <div class="virtual-spacer" style={`height: ${$rowVirtualizer.getTotalSize()}px;`}>
    {#each $rowVirtualizer.getVirtualItems() as row (messages[row.index]?.id || row.key)}
      {#if messages[row.index]}
        <div
          class="virtual-row"
          style={`transform: translateY(${row.start}px);`}
        >
          <MessageRow message={messages[row.index]} />
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .messages-area {
    flex: 1;
    padding: var(--space-md) 0;
    overflow-y: auto;
  }

  .virtual-spacer {
    position: relative;
    width: 100%;
  }

  .virtual-row {
    left: 0;
    position: absolute;
    top: 0;
    width: 100%;
  }
</style>
