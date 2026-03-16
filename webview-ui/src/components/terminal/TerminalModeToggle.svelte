<script lang="ts">
  import { settingsStore } from "../../stores/settingsStore";
  import { realtimeStore } from "../../stores/realtimeStore";

  function handleToggle() {
    const current = $settingsStore.autoApproveSettings;
    settingsStore.setAutoApproveSettings({
      ...current,
      executeSafeCommands: !current.executeSafeCommands
    });
  }

  let isSmartMode = $derived($settingsStore.autoApproveSettings.executeSafeCommands);
  let isTerminalActive = $derived($realtimeStore.terminalActive);
  let pendingApprovals = $derived($realtimeStore.pendingApprovalsCount);
</script>

<div class="mode-toggle-wrapper">
  {#if isTerminalActive && !pendingApprovals}
    <div class="activity-badge active" title="Terminal is executing a command">
      <span class="pulsing-dot"></span>
    </div>
  {/if}

  {#if pendingApprovals > 0}
    <div
      class="activity-badge pending"
      title="{pendingApprovals} command{pendingApprovals > 1
        ? 's'
        : ''} awaiting approval"
    >
      {pendingApprovals}
    </div>
  {/if}

  <label class="toggle-switch">
    <input type="checkbox" checked={isSmartMode} onchange={handleToggle} />
    <span class="toggle-slider"></span>
  </label>
  <span class="mode-label">
    {#if isSmartMode}
      Smart Auto
    {:else}
      Manual
    {/if}
  </span>
</div>

<style>
  .activity-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65rem;
    font-weight: 700;
    height: 1.25rem;
    min-width: 1.25rem;
    padding: 0 0.375rem;
    border-radius: 0.625rem;
    color: white;
    cursor: help;
  }

  .activity-badge.pending {
    background: #f59e0b;
    box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
    animation: pulse-amber 2s infinite;
  }

  .activity-badge.active {
    background: transparent;
    border: 1px solid rgba(139, 92, 246, 0.5);
    border-radius: 50%;
    width: 1.25rem;
    padding: 0;
  }

  .pulsing-dot {
    width: 0.375rem;
    height: 0.375rem;
    background-color: #8b5cf6;
    border-radius: 50%;
    animation: pulse-purple 1.5s infinite;
  }

  @keyframes pulse-amber {
    0% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
    }
    70% {
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
  }

  @keyframes pulse-purple {
    0% {
      transform: scale(0.8);
      opacity: 0.5;
    }
    50% {
      transform: scale(1.2);
      opacity: 1;
    }
    100% {
      transform: scale(0.8);
      opacity: 0.5;
    }
  }

  .mode-toggle-wrapper {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 1.5rem;
    height: 0.875rem;
    cursor: pointer;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 1rem;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 0.5rem;
    width: 0.5rem;
    left: 0.125rem;
    bottom: 0.1875rem;
    background: linear-gradient(135deg, #ffffff 0%, #e0e0e0 100%);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 50%;
  }

  input:checked + .toggle-slider {
    background: linear-gradient(135deg, #8a2be2 0%, #6a1bb2 100%);
    border-color: rgba(138, 43, 226, 0.4);
    box-shadow: 0 0 8px rgba(138, 43, 226, 0.3);
  }

  input:checked + .toggle-slider:before {
    transform: translateX(0.625rem);
    background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%);
    box-shadow: 0 1px 6px rgba(138, 43, 226, 0.4);
  }

  .toggle-slider:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
  }

  input:checked + .toggle-slider:hover {
    background: linear-gradient(135deg, #9a3bf2 0%, #7a2bc2 100%);
    box-shadow: 0 0 12px rgba(138, 43, 226, 0.4);
  }

  .mode-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    gap: 0.25rem;
    user-select: none;
  }
</style>
