<script lang="ts">
    import { settingsStore } from "../../stores/settingsStore";

    $: agentMode = $settingsStore.agentMode;
</script>

<div class="setting-section">
    <div class="setting-header">
        <span class="setting-icon">🤖</span>
        <span class="setting-label">Agent Mode</span>
        <label class="toggle-switch">
            <input
                type="checkbox"
                checked={agentMode}
                on:change={() => settingsStore.toggleAgentMode()}
                aria-label="Toggle Agent Mode"
            />
            <span class="toggle-slider"></span>
        </label>
    </div>
    <p class="setting-description">
        {agentMode
            ? "Agent can read files, search code, and execute tools"
            : "Chat mode - AI provides guidance without file access"}
    </p>
</div>

<style>
    .setting-section {
        margin-bottom: 2rem;
    }

    .setting-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.75rem;
    }

    .setting-icon {
        font-size: 1.25rem;
    }

    .setting-label {
        flex: 1;
        font-weight: 600;
        font-size: 0.875rem;
    }

    .setting-description {
        font-size: 0.75rem;
        opacity: 0.7;
        margin: 0.5rem 0 0 0;
    }

    .toggle-switch {
        position: relative;
        display: inline-block;
        width: 48px;
        height: 24px;
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
        background-color: rgba(255, 255, 255, 0.2);
        transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 24px;
    }

    .toggle-slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    input:checked + .toggle-slider {
        background-color: #22c55e;
    }

    input:checked + .toggle-slider:before {
        transform: translateX(24px);
    }

    input:focus + .toggle-slider {
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
    }
</style>
