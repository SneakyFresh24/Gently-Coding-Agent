<script lang="ts">
    import { settingsStore } from "../../stores/settingsStore";

    $: temperature = $settingsStore.temperature;
    $: maxTokens = $settingsStore.maxTokens;
    $: selectedModel = $settingsStore.selectedModel;
    $: selectedModelInfo = $settingsStore.availableModels.find(
        (m) => m.id === selectedModel,
    );
    $: maxOutputLimit = selectedModelInfo?.max_output || 32768;
</script>

<div class="model-params">
    <!-- Temperature -->
    <div class="setting-section">
        <div class="setting-header">
            <span class="setting-icon">🌡️</span>
            <span class="setting-label">Temperature</span>
            <span class="setting-value">{temperature.toFixed(1)}</span>
        </div>
        <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            on:input={(e) =>
                settingsStore.setTemperature(parseFloat(e.currentTarget.value))}
            class="slider"
            aria-label="Adjust Temperature"
        />
        <p class="setting-description">
            Lower = more focused, Higher = more creative
        </p>
    </div>

    <!-- Max Tokens -->
    <div class="setting-section">
        <div class="setting-header">
            <span class="setting-icon">📊</span>
            <span class="setting-label">Max Tokens</span>
            <span class="setting-value">{maxTokens}</span>
        </div>
        <input
            type="range"
            min="1000"
            max={maxOutputLimit}
            step={maxOutputLimit > 32000 ? 1000 : 500}
            value={maxTokens}
            on:input={(e) =>
                settingsStore.setMaxTokens(parseInt(e.currentTarget.value))}
            class="slider"
            aria-label="Adjust Max Tokens"
        />
        <p class="setting-description">Maximum response length</p>
    </div>
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

    .setting-value {
        padding: 0.25rem 0.5rem;
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 600;
    }

    .setting-description {
        font-size: 0.75rem;
        opacity: 0.7;
        margin: 0.5rem 0 0 0;
    }

    .slider {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        outline: none;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
    }

    .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
        background: #2563eb;
    }

    .slider:focus::-webkit-slider-thumb {
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
    }
</style>
