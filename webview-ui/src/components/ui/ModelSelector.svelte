<script lang="ts">
  import { settingsStore, type LLMModel } from "../../stores/settingsStore";
  import Dropdown from "./Dropdown.svelte";

  let selectedModel = $derived($settingsStore.selectedModel);
  let availableModels = $derived($settingsStore.availableModels);

  function handleSelect(model: LLMModel) {
    settingsStore.setSelectedModel(model);
  }
</script>

<div class="model-selector">
  <Dropdown
    items={availableModels}
    value={selectedModel}
    placeholder="Select Model"
    showSearch={true}
    onselect={handleSelect}
    className="model-dropdown-trigger"
    dropdownClassName="model-dropdown-menu"
  />
</div>

<style>
  .model-selector {
    display: inline-block;
  }

  /* Specificity fix: Target only the trigger button, not menu items */
  :global(.model-dropdown-trigger > .dropdown-trigger) {
    min-width: 140px !important;
    font-size: 0.6875rem !important;
    padding: 0.125rem 0.5rem !important;
    height: 24px !important;
  }

  :global(.model-dropdown-menu) {
    min-width: 260px !important;
    bottom: calc(100% + 0.5rem) !important;
  }
</style>
