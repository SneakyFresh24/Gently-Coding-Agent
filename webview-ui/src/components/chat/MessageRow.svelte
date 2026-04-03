<script lang="ts">
  import type { Message } from '../../lib/types';
  import UserMessage from '../message/UserMessage.svelte';
  import AssistantMessage from '../message/AssistantMessage.svelte';
  import ToolMessage from '../message/ToolMessage.svelte';
  import CommandMessage from '../message/CommandMessage.svelte';
  import ErrorMessage from '../message/ErrorMessage.svelte';
  import QuestionCardMessage from '../message/QuestionCardMessage.svelte';
  import PlanCardMessage from '../message/PlanCardMessage.svelte';
  import ToolApprovalCardMessage from '../message/ToolApprovalCardMessage.svelte';

  let {
    message,
  }: {
    message: Message;
  } = $props();
</script>

<div class="message-row" data-role={message.role}>
  {#if message.questionCard}
    <QuestionCardMessage {message} />
  {:else if message.planCard}
    <PlanCardMessage {message} />
  {:else if message.approvalCard}
    <ToolApprovalCardMessage {message} />
  {:else if message.role === 'user'}
    <UserMessage {message} />
  {:else if message.role === 'assistant'}
    <AssistantMessage {message} />
  {:else if message.role === 'tool' || message.role === 'tool-execution'}
    <ToolMessage {message} />
  {:else if message.role === 'command-approval'}
    <CommandMessage {message} />
  {:else if message.role === 'system'}
    {#if message.isSystemMessage}
      <div class="system-message">
        <div>{message.content}</div>
        {#if message.diagnostic?.code || message.diagnostic?.correlationId}
          <div class="system-diagnostic">
            {#if message.diagnostic?.code}
              <span>{message.diagnostic.code}</span>
            {/if}
            {#if message.diagnostic?.correlationId}
              <span>cid: {message.diagnostic.correlationId}</span>
            {/if}
          </div>
        {/if}
      </div>
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

  .system-diagnostic {
    margin-top: 4px;
    display: flex;
    justify-content: center;
    gap: 8px;
    font-style: normal;
    opacity: 0.85;
    font-family: var(--vscode-editor-font-family);
    font-size: 10px;
  }

  .unknown-message {
    font-size: var(--font-size-sm);
    color: var(--vscode-descriptionForeground);
    padding: var(--space-sm) 0;
  }
</style>
