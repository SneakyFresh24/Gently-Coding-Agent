<script lang="ts">
  import { settingsStore } from '../../stores/settingsStore';
  import { slide } from 'svelte/transition';

  export let isOpen = false;

  $: settings = $settingsStore.autoApproveSettings;

  function toggleSetting(key: keyof typeof settings) {
    const newSettings = { ...settings, [key]: !settings[key] };
    settingsStore.setAutoApproveSettings(newSettings);
  }

  function handleYoloToggle() {
    settingsStore.toggleYoloMode(!settings.yoloMode);
  }
</script>

{#if isOpen}
  <div class="auto-approve-menu" transition:slide>
    <div class="menu-header">
      <h3>Auto-Approval Settings</h3>
      <p class="subtitle">Control which actions Gently can perform automatically.</p>
    </div>

    <div class="yolo-section" class:yolo-active={settings.yoloMode}>
      <div class="yolo-info">
        <span class="emoji">🚀</span>
        <div class="text">
          <strong>YOLO Mode</strong>
          <span>Approve EVERYTHING automatically. Use with caution!</span>
        </div>
      </div>
      <label class="switch">
        <input type="checkbox" checked={settings.yoloMode} on:change={handleYoloToggle}>
        <span class="slider round"></span>
      </label>
    </div>

    <div class="settings-grid" class:disabled={settings.yoloMode}>
      <div class="setting-item">
        <label>
          <input type="checkbox" checked={settings.executeSafeCommands} on:change={() => toggleSetting('executeSafeCommands')}>
          <span>Auto-Approve Safe Commands</span>
        </label>
        <span class="hint">npm, git, ls, etc. (formerly Smart Mode)</span>
      </div>

      <div class="setting-item">
        <label>
          <input type="checkbox" checked={settings.readFiles} on:change={() => toggleSetting('readFiles')}>
          <span>Read Workspace Files</span>
        </label>
      </div>

      <div class="setting-item">
        <label>
          <input type="checkbox" checked={settings.editFiles} on:change={() => toggleSetting('editFiles')}>
          <span>Edit Workspace Files</span>
        </label>
      </div>

      <hr />

      <div class="setting-item risky">
        <label>
          <input type="checkbox" checked={settings.readFilesExternally} on:change={() => toggleSetting('readFilesExternally')}>
          <span>Read External Files</span>
        </label>
      </div>

      <div class="setting-item risky">
        <label>
          <input type="checkbox" checked={settings.editFilesExternally} on:change={() => toggleSetting('editFilesExternally')}>
          <span>Edit External Files</span>
        </label>
      </div>

      <div class="setting-item">
        <label>
          <input type="checkbox" checked={settings.useBrowser} on:change={() => toggleSetting('useBrowser')}>
          <span>Use Browser</span>
        </label>
      </div>

      <div class="setting-item">
        <label>
          <input type="checkbox" checked={settings.useMcp} on:change={() => toggleSetting('useMcp')}>
          <span>Use MCP Tools</span>
        </label>
      </div>
    </div>
  </div>
{/if}

<style>
  .auto-approve-menu {
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  }

  .menu-header {
    margin-bottom: 12px;
  }

  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--vscode-foreground);
  }

  .subtitle {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin: 2px 0 0 0;
  }

  .yolo-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: var(--vscode-input-background);
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 16px;
    border: 1px solid transparent;
    transition: all 0.2s;
  }

  .yolo-active {
    border-color: #ff9800;
    box-shadow: 0 0 8px rgba(255, 152, 0, 0.3);
  }

  .yolo-info {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .yolo-info .text {
    display: flex;
    flex-direction: column;
  }

  .yolo-info strong {
    font-size: 12px;
    color: #ff9800;
  }

  .yolo-info span {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
  }

  .settings-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: opacity 0.2s;
  }

  .disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .setting-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-item label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 12px;
  }

  .setting-item span.hint {
    font-size: 10px;
    color: var(--vscode-descriptionForeground);
    margin-left: 22px;
  }

  .risky {
    color: var(--vscode-errorForeground);
  }

  hr {
    border: 0;
    border-top: 1px solid var(--vscode-widget-border);
    margin: 4px 0;
  }

  /* Switch styling */
  .switch {
    position: relative;
    display: inline-block;
    width: 34px;
    height: 18px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ccc;
    transition: .4s;
    border-radius: 18px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    transition: .4s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: #ff9800;
  }

  input:checked + .slider:before {
    transform: translateX(16px);
  }
</style>
