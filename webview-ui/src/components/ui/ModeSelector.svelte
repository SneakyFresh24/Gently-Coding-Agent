<script lang="ts">
  import { settingsStore } from "../../stores/settingsStore";
  import Dropdown from "./Dropdown.svelte";

  // Available modes
  const availableModes = [
    {
      id: "architect",
      name: "Architect",
      description: "For planning and designing before implementation",
      icon: "🏗️",
    },
    {
      id: "code",
      name: "Code",
      description: "For writing, modifying, and refactoring code",
      icon: "💻",
    },
  ];

  let selectedMode = $derived($settingsStore.selectedMode || "architect");

  function handleSelect(mode: string) {
    settingsStore.setSelectedMode(mode);
  }
</script>

<div class="mode-selector">
  <Dropdown
    items={availableModes}
    value={selectedMode}
    placeholder="Select Mode"
    onselect={handleSelect}
    className="mode-dropdown-trigger"
    dropdownClassName="mode-dropdown-menu"
  />
</div>

<style>
  .mode-selector {
    display: inline-block;
  }

  /* Specificity fix: Target only the trigger button, not menu items */
  :global(.mode-dropdown-trigger > .dropdown-trigger) {
    min-width: 140px !important;
    font-size: 0.6875rem !important;
    padding: 0.125rem 0.5rem !important;
    height: 24px !important;
  }

  :global(.mode-dropdown-menu) {
    min-width: 280px !important;
    bottom: calc(100% + 0.5rem) !important;
  }
</style>
