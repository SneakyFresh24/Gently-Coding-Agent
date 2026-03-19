<script lang="ts">
  import type { ModelInfo } from '../../lib/types';
  import TokenDisplay from './TokenDisplay.svelte';
  import Icon from '../ui/Icon.svelte';
  import { messaging } from '../../lib/messaging';

  
  export let currentView = 'chat';
  export let tokens = 0;
  
  function setView(view: string) {
    currentView = view;
  }

  function startNewChat() {
    messaging.send('newSession');
    currentView = 'chat';
  }

</script>

<header class="main-header">
  <div class="left">
    <div class="brand">
      <Icon name="hubot" size={20} />
      <span class="name">Gently</span>
    </div>
    
    <nav class="main-nav">
      <button 
        class="nav-item" 
        class:active={currentView === 'chat'} 
        on:click={() => setView('chat')}
        title="Chat"
      >
        <Icon name="comment" size={18} />
      </button>
      <button 
        class="nav-item" 
        class:active={currentView === 'guardian'} 
        on:click={() => setView('guardian')}
        title="Guardian"
      >
        <Icon name="shield" size={18} />
      </button>
      <button 
        class="nav-item" 
        class:active={currentView === 'history'} 
        on:click={() => setView('history')}
        title="History"
      >
        <Icon name="history" size={18} />
      </button>

      <button 
        class="nav-item new-chat-btn" 
        on:click={startNewChat}
        title="New Chat"
      >
        <Icon name="add" size={18} />
      </button>
    </nav>

  </div>

  <div class="right">
    <TokenDisplay {tokens} />
    <button 
      class="settings-btn" 
      class:active={currentView === 'settings'}
      on:click={() => setView('settings')}
      title="Settings"
    >
      <Icon name="settings-gear" size={18} />
    </button>
  </div>
</header>

<style>
  .main-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 12px;
    background: var(--vscode-sideBar-background);
    border-bottom: 1px solid var(--vscode-widget-border);
    flex-shrink: 0;
  }

  .left, .right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-right: 8px;
  }

  .name {
    font-size: 13px;
    color: var(--vscode-foreground);
  }

  .main-nav {
    display: flex;
    gap: 4px;
    padding: 0 8px;
    border-left: 1px solid var(--vscode-widget-border);
  }

  .nav-item, .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
    color: var(--vscode-foreground);
    opacity: 0.6;
    transition: all 0.2s ease;
  }

  .nav-item:hover, .settings-btn:hover {
    background: var(--vscode-list-hoverBackground);
    opacity: 1;
  }

  .nav-item.active, .settings-btn.active {
    color: var(--vscode-list-activeSelectionForeground);
    opacity: 1;
  }

  .new-chat-btn {
    margin-left: 4px;
    color: var(--vscode-button-background);
  }

  .new-chat-btn:hover {
    color: var(--vscode-button-hoverBackground);
  }
</style>

