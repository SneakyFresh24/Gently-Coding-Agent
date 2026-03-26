<script lang="ts">
  import type { Message } from '../../lib/types';
  import MessageRow from './MessageRow.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { createVirtualizer } from '@tanstack/svelte-virtual';

  const VIRTUALIZATION_THRESHOLD = 80;
  const ESTIMATE_SIZE = 220;
  const OVERSCAN = 8;
  const BOTTOM_THRESHOLD_PX = 60;

  let {
    messages = [],
    resetEpoch = 0,
  }: {
    messages?: Message[];
    resetEpoch?: number;
  } = $props();

  let containerRef: HTMLDivElement | undefined = $state();
  let autoScroll = true;
  const isVirtualized = $derived(messages.length >= VIRTUALIZATION_THRESHOLD);

  const virtualizerStore = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => containerRef ?? null,
    estimateSize: () => ESTIMATE_SIZE,
    overscan: OVERSCAN,
  });

  function handleScroll() {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    autoScroll = scrollHeight - scrollTop - clientHeight < BOTTOM_THRESHOLD_PX;
  }

  function measureVirtualRow(node: HTMLDivElement, _content: string) {
    $virtualizerStore.measureElement(node);

    return {
      update() {
        $virtualizerStore.measureElement(node);
      },
    };
  }

  async function scrollToBottom() {
    if (!autoScroll || !containerRef) return;

    await tick();

    if (isVirtualized && messages.length > 0) {
      $virtualizerStore.scrollToIndex(messages.length - 1, { align: 'end' });
      return;
    }

    containerRef.scrollTop = containerRef.scrollHeight;
  }

  $effect(() => {
    const count = messages.length;
    const ref = containerRef;

    untrack(() => {
      $virtualizerStore.setOptions({
        count,
        getScrollElement: () => ref ?? null,
        estimateSize: () => ESTIMATE_SIZE,
        overscan: OVERSCAN,
      });
    });
  });

  $effect(() => {
    const epoch = resetEpoch;
    const currentMessages = messages;
    const virtualized = isVirtualized;
    const messageCount = currentMessages.length;
    const lastContent = currentMessages[messageCount - 1]?.content;
    void epoch;
    void messageCount;
    void lastContent;

    untrack(() => {
      if (virtualized) {
        $virtualizerStore.measure();
      }
      autoScroll = true;

      scrollToBottom();
    });
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
  {#if isVirtualized}
    <div
      class="virtual-viewport"
      style={`height: ${$virtualizerStore.getTotalSize()}px;`}
    >
      {#each $virtualizerStore.getVirtualItems() as virtualItem (virtualItem.key)}
        {@const message = messages[virtualItem.index]}
        {#if message}
          <div
            class="virtual-row"
            data-index={virtualItem.index}
            style={`transform: translateY(${virtualItem.start}px);`}
            use:measureVirtualRow={message.content}
          >
            <MessageRow {message} />
          </div>
        {/if}
      {/each}
    </div>
  {:else}
    {#each messages as message (message.id)}
      <MessageRow {message} />
    {/each}
  {/if}
</div>

<style>
  .messages-area {
    flex: 1;
    padding: var(--space-md) 0;
    overflow-y: auto;
  }

  .virtual-viewport {
    position: relative;
    width: 100%;
  }

  .virtual-row {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
  }
</style>
