<script lang="ts">
  import type { Message } from '../../lib/types';
  import UserMessage from '../message/UserMessage.svelte';
  import AssistantMessage from '../message/AssistantMessage.svelte';
  import ToolMessage from '../message/ToolMessage.svelte';
  import CommandMessage from '../message/CommandMessage.svelte';
  import ErrorMessage from '../message/ErrorMessage.svelte';

  let {
    message,
  }: {
    message: Message;
  } = $props();
</script>

<div class="message-row" data-role={message.role}>
  {#if message.role === 'user'}
    <UserMessage {message} />
  {:else if message.role === 'assistant'}
    <AssistantMessage {message} />
  {:else if message.role === 'tool' || message.role === 'tool-execution'}
    <ToolMessage {message} />
  {:else if message.role === 'command-approval'}
    <CommandMessage {message} />
  {:else if message.role === 'system'}
    {#if message.isSystemMessage}
      <div class="system-message">{message.content}</div>
    {:else}
      <AssistantMessage {message} />
    {/if}
  {:else}
    <div class="unknown-message">{message.content}</div>
  {/if}
</div>

<style>
  .message-row {
    padding: var(--space-xs) var(--space-xl);
  }

  .system-message {
    font-size: var(--font-size-xs);
    color: var(--vscode-descriptionForeground);
    text-align: center;
    padding: var(--space-sm) 0;
    font-style: italic;
  }

  .unknown-message {
    font-size: var(--font-size-sm);
    color: var(--vscode-descriptionForeground);
    padding: var(--space-sm) 0;
  }
</style>
