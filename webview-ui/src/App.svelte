<script lang="ts">
  import { onMount } from 'svelte';
  import Header from './components/layout/Header.svelte';
  import ChatView from './components/chat/ChatView.svelte';
  import GuardianView from './components/guardian/GuardianView.svelte';
  import HistoryView from './components/history/HistoryView.svelte';
  import SettingsView from './components/settings/SettingsView.svelte';

  import { settingsStore } from './stores/settingsStore';
  import { messaging } from './lib/messaging';

  let currentView = 'chat';
  let tokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
    estimatedCostUsd: null as number | null,
    lastUpdated: 0
  };
  let currentContextTokens = 0;
  let tokenMax = 200000;
  let tokenPricing: { prompt?: number; completion?: number; cache_read?: number; cache_write?: number } | null = null;
  let tokenCost: number | null = null;
  let compressionLevel: 'none' | 'proactive' | 'aggressive' = 'none';
  let tokenWarnings: string[] = [];

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    switch (message.type) {
      case 'tokenTrackerUpdate':
        tokenUsage = {
          promptTokens: Number(message.usage?.promptTokens || 0),
          completionTokens: Number(message.usage?.completionTokens || 0),
          totalTokens: Number(message.usage?.totalTokens || 0),
          cacheReadInputTokens: Number(message.usage?.cacheReadInputTokens || 0),
          cacheWriteInputTokens: Number(message.usage?.cacheWriteInputTokens || 0),
          estimatedCostUsd: message.usage?.estimatedCostUsd ?? null,
          lastUpdated: Number(message.usage?.lastUpdated || 0)
        };
        tokenMax = Number(message.maxTokens || 200000);
        currentContextTokens = Number(message.currentContextTokens ?? message.usage?.currentContextTokens ?? 0);
        tokenPricing = message.pricing || null;
        tokenCost = message.cost ?? null;
        compressionLevel = message.compressionLevel || message.usage?.compressionLevel || 'none';
        tokenWarnings = Array.isArray(message.warnings)
          ? message.warnings
          : Array.isArray(message.usage?.warnings)
            ? message.usage.warnings
            : [];
        break;
      case 'modelsList':
        if (message.models && message.models.length > 0) {
          settingsStore.setModels(message.models);
        }
        break;
      case 'modelChanged':
        settingsStore.setSelectedModel(message.model);
        break;
      case 'apiKeyStatus':
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
    tokenState={{
      usage: tokenUsage,
      currentContextTokens,
      maxTokens: tokenMax,
      pricing: tokenPricing,
      cost: tokenCost,
      compressionLevel,
      warnings: tokenWarnings
    }}
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
