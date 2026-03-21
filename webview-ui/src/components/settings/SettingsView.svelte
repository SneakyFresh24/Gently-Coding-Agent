<script lang="ts">
  import { settingsStore } from '../../stores/settingsStore';
  import { onMount } from 'svelte';

  let apiKey = '';
  let showKey = false;

  function saveApiKey() {
    if (apiKey.trim()) {
      settingsStore.setApiKey(apiKey);
      apiKey = '';
    }
  }

  function deleteApiKey() {
    if (confirm('Are you sure you want to delete your API key?')) {
      settingsStore.deleteApiKey();
    }
  }

  function handleMaxTokensChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    settingsStore.setMaxTokens(value);
  }

  onMount(() => {
    // Initial status check
    window.postMessage({ type: 'checkApiKey' }, '*');
  });
</script>

<div class="settings-view">
  <header class="view-header">
    <h2>Settings</h2>
    <p class="subtitle">Configure your Gently experience</p>
  </header>

  <section class="settings-section">
    <h3>OpenRouter API</h3>
    <div class="setting-item">
      <div class="label-group">
        <label for="api-key">API Key</label>
        <p class="description">Required for LLM access. Your key is stored securely in VS Code.</p>
      </div>
      
      {#if $settingsStore.hasApiKey}
        <div class="api-status success">
          <span class="icon">✅</span>
          <span class="text">API key is set</span>
          <button class="delete-btn" on:click={deleteApiKey}>Delete Key</button>
        </div>
      {:else}
        <div class="api-input-group">
          <div class="input-wrapper">
            <input 
              id="api-key"
              type={showKey ? 'text' : 'password'} 
              placeholder="sk-or-v1-..." 
              bind:value={apiKey}
            />
            <button class="toggle-visibility" on:click={() => showKey = !showKey}>
              {showKey ? '👁️' : '🙈'}
            </button>
          </div>
          <button class="save-btn" on:click={saveApiKey} disabled={!apiKey.trim()}>
            Save Key
          </button>
        </div>
      {/if}
    </div>
  </section>

  <section class="settings-section">
    <h3>Model Preferences</h3>
    <div class="setting-item">
      <div class="label-group">
        <label for="max-tokens">Max Tokens per Request</label>
        <p class="description">Higher limits allow for longer responses but may increase cost.</p>
      </div>
      <div class="range-group">
        <input 
          id="max-tokens"
          type="range" 
          min="1000" 
          max="32000" 
          step="1000"
          value={$settingsStore.maxTokens}
          on:change={handleMaxTokensChange}
        />
        <span class="range-value">{($settingsStore.maxTokens / 1000).toFixed(0)}k</span>
      </div>
    </div>
  </section>

  <section class="settings-section">
    <h3>General</h3>
    <div class="setting-item">
      <div class="checkbox-group">
        <input type="checkbox" id="auto-scroll" checked />
        <label for="auto-scroll">Auto-scroll to bottom of chat</label>
      </div>
    </div>
    <div class="setting-item">
      <div class="checkbox-group">
        <input type="checkbox" id="render-markdown" checked />
        <label for="render-markdown">Enable Markdown & Syntax Highlighting</label>
      </div>
    </div>
  </section>

  <footer class="settings-footer">
    <p>Gently AI v0.7.2 • <a href="https://github.com/SneakyFresh24/Gently-Coding-Agent" target="_blank">Documentation</a></p>
  </footer>
</div>

<style>
  .settings-view {
    padding: 24px;
    max-width: 800px;
    margin: 0 auto;
    color: var(--vscode-foreground);
  }

  .view-header {
    margin-bottom: 32px;
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

  .settings-section {
    margin-bottom: 32px;
    border-top: 1px solid var(--vscode-widget-border);
    padding-top: 24px;
  }

  h3 {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    opacity: 0.9;
  }

  .setting-item {
    margin-bottom: 24px;
  }

  .label-group {
    margin-bottom: 12px;
  }

  label {
    display: block;
    font-weight: 600;
    font-size: 13px;
    margin-bottom: 4px;
  }

  .description {
    font-size: 12px;
    opacity: 0.6;
    margin: 0;
  }

  .api-status {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 6px;
  }

  .api-status.success .icon {
    color: #4caf50;
  }

  .api-status .text {
    flex: 1;
    font-size: 13px;
  }

  .delete-btn {
    padding: 4px 12px;
    background: transparent;
    border: 1px solid var(--vscode-errorForeground);
    color: var(--vscode-errorForeground);
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: all 0.2s ease;
  }

  .delete-btn:hover {
    background: var(--vscode-errorForeground);
    color: white;
  }

  .api-input-group {
    display: flex;
    gap: 8px;
  }

  .input-wrapper {
    flex: 1;
    position: relative;
    display: flex;
  }

  .api-input-group input {
    flex: 1;
    padding: 8px 36px 8px 12px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    font-size: 13px;
  }

  .toggle-visibility {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.6;
    font-size: 14px;
  }

  .save-btn {
    padding: 8px 16px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .range-group {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .range-group input {
    flex: 1;
  }

  .range-value {
    min-width: 32px;
    font-weight: 600;
    font-size: 13px;
    color: var(--vscode-foreground);
  }

  .checkbox-group {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .checkbox-group input {
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .checkbox-group label {
    margin: 0;
    font-weight: 400;
    cursor: pointer;
  }

  .settings-footer {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--vscode-widget-border);
    text-align: center;
    font-size: 11px;
    opacity: 0.5;
  }

  a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }
</style>
