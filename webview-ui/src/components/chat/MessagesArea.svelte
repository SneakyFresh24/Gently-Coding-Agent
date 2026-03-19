<script lang="ts">
  import type { Message } from '../../lib/types';
  import MessageRow from './MessageRow.svelte';
  import { onMount, tick } from 'svelte';

  let {
    messages = [],
  }: {
    messages?: Message[];
  } = $props();

  let containerRef: HTMLDivElement | undefined = $state();
  let autoScroll = true;

  function handleScroll() {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    // Consider "at bottom" if within 60px
    autoScroll = scrollHeight - scrollTop - clientHeight < 60;
  }

  async function scrollToBottom() {
    if (!autoScroll || !containerRef) return;
    await tick();
    containerRef.scrollTop = containerRef.scrollHeight;
  }

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
  {#each messages as message (message.id)}
    <MessageRow {message} />
  {/each}
</div>

<style>
  .messages-area {
    flex: 1;
    padding: var(--space-md) 0;
    overflow-y: auto;
  }
</style>
