<script lang="ts">
  import { onMount } from 'svelte';
  import type { ModelInfo } from './lib/types';
  import Header from './components/layout/Header.svelte';
  import ChatView from './components/chat/ChatView.svelte';
  import GuardianView from './components/guardian/GuardianView.svelte';
  import HistoryView from './components/history/HistoryView.svelte';
  import SettingsView from './components/settings/SettingsView.svelte';

  import { settingsStore } from './stores/settingsStore';
  import { messaging } from './lib/messaging';

  let currentView = 'chat';
  let models: ModelInfo[] = [];
  let selectedModel = '';
  let tokens = 0;

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    switch (message.type) {
      case 'tokenTrackerUpdate':
        tokens = message.usage?.totalTokens || 0;
        break;
      case 'modelsList':
        if (message.models && message.models.length > 0) {
          models = message.models;
          settingsStore.setModels(message.models);
          if (!selectedModel) {
            selectedModel = models[0].id;
            settingsStore.setSelectedModel(selectedModel);
          }
        }
        break;
      case 'modelChanged':
        selectedModel = message.model;
        settingsStore.setSelectedModel(message.model);
        break;
      case 'onApiKeyStatus':
        settingsStore.setApiKeyStatus(message.hasKey);
        break;
    }
  }

  onMount(() => {
    window.addEventListener('message', handleMessage);
    // Initial fetch of models and tokens
    messaging.send('fetchModels');
    messaging.send('getTokenUsage');
    
    return () => window.removeEventListener('message', handleMessage);
  });
</script>

<main class="app-container">
  <Header 
    bind:currentView 
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
