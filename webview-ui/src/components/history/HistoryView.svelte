<script lang="ts">
  import { onMount } from 'svelte';
  import { historyStore, filteredSessions } from '../../stores/historyStore';
  import HistoryItem from './HistoryItem.svelte';

  let searchQuery = '';

  $: {
    historyStore.setSearchQuery(searchQuery);
  }

  function handleLoad(event: CustomEvent<{id: string}>) {
    historyStore.loadSession(event.detail.id);
  }

  function handleDelete(event: CustomEvent<{id: string}>) {
    if (confirm('Are you sure you want to delete this session?')) {
      historyStore.deleteSession(event.detail.id);
    }
  }

  onMount(() => {
    historyStore.fetchHistory();
    // Dummy initial data for demonstration if empty
    setTimeout(() => {
      if ($historyStore.sessions.length === 0) {
        historyStore.setSessions([
          { id: '101', title: 'Refactoring Backend', timestamp: Date.now() - 3600000, messageCount: 24, model: 'deepseek-chat' },
          { id: '102', title: 'Fixing CSS Grid', timestamp: Date.now() - 86400000, messageCount: 12, model: 'gpt-4o' },
          { id: '103', title: 'Planning New Features', timestamp: Date.now() - 172800000, messageCount: 45, model: 'claude-3-5-sonnet' }
        ]);
      }
    }, 500);
  });
</script>

<div class="history-view">
  <header class="view-header">
    <div class="title-group">
      <h2>Chat History</h2>
      <p class="subtitle">Review and restore your past conversations</p>
    </div>
  </header>

  <div class="search-bar">
    <input 
      type="text" 
      placeholder="Search history..." 
      bind:value={searchQuery}
    />
    <span class="icon">🔍</span>
  </div>

  <div class="history-list">
    {#if $historyStore.isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading history...</p>
      </div>
    {:else if $filteredSessions.length === 0}
      <div class="empty-state">
        <span class="icon">📭</span>
        <p>No sessions found.</p>
      </div>
    {:else}
      {#each $filteredSessions as session (session.id)}
        <HistoryItem 
          {session} 
          on:load={handleLoad} 
          on:delete={handleDelete} 
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .history-view {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
    color: var(--vscode-foreground);
  }

  .view-header {
    margin-bottom: 24px;
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
  }

  .subtitle {
    margin: 4px 0 0;
    opacity: 0.6;
    font-size: 13px;
  }

  .search-bar {
    position: relative;
    margin-bottom: 24px;
  }

  .search-bar input {
    width: 100%;
    padding: 10px 12px 10px 36px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px;
    font-size: 13px;
  }

  .search-bar .icon {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    opacity: 0.5;
  }

  .loading-state, .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px;
    text-align: center;
  }

  .loading-state .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--vscode-progressBar-background);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .empty-state .icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .empty-state p {
    opacity: 0.7;
  }
</style>
