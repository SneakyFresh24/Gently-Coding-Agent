<script lang="ts">
  import { settingsStore, hasModels } from '../../stores/settingsStore';
  import { extensionStore } from '../../stores/extensionStore';
  import Button from '../ui/Button.svelte';
  import ModelSelector from './ModelSelector.svelte';

  let apiKeyInput = $state('');

  function handleSaveKey() {
    if (!apiKeyInput.trim()) return;
    settingsStore.setApiKey(apiKeyInput.trim());
    apiKeyInput = '';
  }

  function handleDeleteKey() {
    settingsStore.deleteApiKey();
  }
</script>

<div class="settings-view scrollable">
  <h2 class="settings-title">Settings</h2>

  <!-- API Key Section -->
  <section class="settings-section">
    <h3 class="section-title">OpenRouter API Key</h3>

    {#if $settingsStore.hasApiKey}
      <div class="key-status">
        <span class="status-ok">✅ API key configured</span>
        <Button variant="danger" size="sm" onclick={handleDeleteKey}>
          Remove Key
        </Button>
      </div>
    {:else}
      <div class="key-input-row">
        <input
          type="password"
          class="key-input"
          placeholder="sk-or-v1-..."
          bind:value={apiKeyInput}
          onkeydown={(e) => e.key === 'Enter' && handleSaveKey()}
        />
        <Button variant="primary" size="sm" onclick={handleSaveKey} disabled={!apiKeyInput.trim()}>
          Save
        </Button>
      </div>
      <p class="key-hint">
        Get your API key from <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys</a>
      </p>
    {/if}
  </section>

  <!-- Model Selection -->
  <section class="settings-section">
    <h3 class="section-title">Model</h3>
    <ModelSelector />
  </section>

  <!-- Max Tokens -->
  <section class="settings-section">
    <h3 class="section-title">Max Tokens</h3>
    <div class="token-row">
      <input
        type="number"
        class="token-input"
        value={$settingsStore.maxTokens}
        min="1"
        max="64000"
        onchange={(e) => settingsStore.setMaxTokens(parseInt((e.target as HTMLInputElement).value))}
      />
      <span class="token-label">tokens</span>
    </div>
  </section>
</div>

<style>
  .settings-view {
    padding: var(--space-xl);
    height: 100%;
  }

  .settings-title {
    font-size: var(--font-size-xl);
    font-weight: 700;
    color: var(--vscode-foreground);
    margin-bottom: var(--space-3xl);
  }

  .settings-section {
    margin-bottom: var(--space-3xl);
  }

  .section-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--vscode-foreground);
    margin-bottom: var(--space-md);
  }

  .key-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-lg);
  }

  .status-ok {
    font-size: var(--font-size-sm);
    color: var(--vscode-gitDecoration-addedResourceForeground, #73c991);
  }

  .key-input-row {
    display: flex;
    gap: var(--space-md);
    margin-bottom: var(--space-sm);
  }

  .key-input {
    flex: 1;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-input-foreground);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: var(--font-size-sm);
  }

  .key-input:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
  }

  .key-hint {
    font-size: var(--font-size-xs);
    color: var(--vscode-descriptionForeground);
  }

  .token-row {
    display: flex;
    align-items: center;
    gap: var(--space-md);
  }

  .token-input {
    width: 100px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
    color: var(--vscode-input-foreground);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: var(--font-size-sm);
  }

  .token-input:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
  }

  .token-label {
    font-size: var(--font-size-sm);
    color: var(--vscode-descriptionForeground);
  }
</style>
