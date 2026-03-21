<script lang="ts">
  import type { SessionInfo } from '../../stores/historyStore';
  import { createEventDispatcher } from 'svelte';

  export let session: SessionInfo;

  const dispatch = createEventDispatcher();

  function deleteSession(e: MouseEvent) {
    e.stopPropagation();
    dispatch('delete', { id: session.id });
  }

  function loadSession() {
    dispatch('load', { id: session.id });
  }

  $: date = new Date(session.timestamp).toLocaleDateString();
  $: time = new Date(session.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div 
  class="history-item" 
  on:click={loadSession} 
  on:keydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      loadSession();
    }
  }}
  role="button"
  tabindex="0"
>
  <div class="item-content">
    <div class="top-row">
      <span class="title">{session.title || 'Untitled Session'}</span>
      <span class="date">{date}</span>
    </div>
    <div class="bottom-row">
      <span class="model">{session.model || 'No model selected'}</span>
      <span class="dot">•</span>
      <span class="msgs">{session.messageCount} messages</span>
      <span class="dot">•</span>
      <span class="time">{time}</span>
    </div>
  </div>
  
  <button class="delete-btn" on:click={deleteSession} title="Delete session" aria-label={`Delete session ${session.title || 'Untitled Session'}`}>
    ✕
  </button>
</div>

<style>
  .history-item {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
  }

  .history-item:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: var(--vscode-focusBorder);
  }

  .item-content {
    flex: 1;
    min-width: 0;
  }

  .top-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .title {
    font-weight: 600;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 12px;
  }

  .date {
    font-size: 11px;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .bottom-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    opacity: 0.6;
  }

  .dot {
    font-size: 8px;
  }

  .delete-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--vscode-foreground);
    opacity: 0;
    cursor: pointer;
    border-radius: 4px;
    font-size: 14px;
    transition: opacity 0.2s, background 0.2s;
    margin-left: 8px;
  }

  .history-item:hover .delete-btn {
    opacity: 0.4;
  }

  .delete-btn:hover {
    opacity: 1 !important;
    background: var(--vscode-errorForeground);
    color: white;
  }
</style>
