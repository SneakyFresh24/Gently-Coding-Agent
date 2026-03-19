<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './components/layout/Header.svelte';
  import ChatView from './components/chat/ChatView.svelte';
  import GuardianView from './components/guardian/GuardianView.svelte';
  import HistoryView from './components/history/HistoryView.svelte';
  import SettingsView from './components/settings/SettingsView.svelte';

  let currentView = 'chat';
  let selectedModel = 'deepseek-chat';
  let models: string[] = ['deepseek-chat', 'gpt-4o', 'claude-3-5-sonnet'];
  let tokens = 0;

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    switch (message.type) {
      case 'tokenTrackerUpdate':
        tokens = message.usage?.totalTokens || 0;
        break;
      case 'modelsList':
        if (message.models && message.models.length > 0) {
          models = message.models.map((m: any) => m.id);
        }
        break;
      case 'modelChanged':
        // This is sent from ModelDropdown
        selectedModel = message.model;
        break;
    }
  }

  onMount(() => {
    window.addEventListener('message', handleMessage);
    // Initial fetch of models and tokens
    window.postMessage({ type: 'fetchModels' }, '*');
    window.postMessage({ type: 'getTokenUsage' }, '*');
    
    return () => window.removeEventListener('message', handleMessage);
  });
</script>

<main class="app-container">
  <Header 
    bind:currentView 
    bind:selectedModel 
    {models} 
    {tokens} 
  />
  
  <div class="content-area">
    {#if currentView === 'chat'}
      <ChatView />
    {:else if currentView === 'guardian'}
      <GuardianView />
    {:else if currentView === 'history'}
      <HistoryView />
    {:else if currentView === 'settings'}
      <SettingsView />
    {/if}
  </div>
</main>

<style>
  :global(:root) {
    --header-height: 48px;
  }

  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    overflow: hidden;
    background: var(--vscode-sideBar-background);
  }

  .content-area {
    flex: 1;
    overflow: auto;
    position: relative;
  }
</style>
