<script lang="ts">
    import { onMount } from "svelte";
    import { ChevronDown, Search } from "lucide-svelte";
    import { slide } from "svelte/transition";

    interface Props {
        items?: any[];
        value?: any;
        placeholder?: string;
        searchPlaceholder?: string;
        showSearch?: boolean;
        labelKey?: string;
        valueKey?: string;
        descriptionKey?: string;
        iconKey?: string;
        className?: string;
        dropdownClassName?: string;
        onselect?: (value: any) => void;
    }

    let {
        items = [],
        value = null,
        placeholder = "Select item",
        searchPlaceholder = "Search...",
        showSearch = false,
        labelKey = "name",
        valueKey = "id",
        descriptionKey = "description",
        iconKey = "icon",
        className = "",
        dropdownClassName = "",
        onselect,
    }: Props = $props();

    let isOpen = $state(false);
    let searchQuery = $state("");
    let container = $state<HTMLDivElement | null>(null);

    let selectedItem = $derived(
        items.find(
            (item: any) =>
                (typeof item === "object" ? item[valueKey] : item) === value,
        ),
    );

    let filteredItems = $derived(
        showSearch
            ? items.filter((item: any) => {
                  const label =
                      typeof item === "object" ? item[labelKey] : String(item);
                  return label
                      .toLowerCase()
                      .includes(searchQuery.toLowerCase());
              })
            : items,
    );

    function toggle() {
        isOpen = !isOpen;
        if (isOpen) searchQuery = "";
    }

    function select(item: any) {
        const newValue = typeof item === "object" ? item[valueKey] : item;
        if (onselect) {
            onselect(newValue);
        }
        isOpen = false;
    }

    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            isOpen = false;
        } else if (event.key === "Enter" && !isOpen) {
            isOpen = true;
        }
    }

    onMount(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                isOpen &&
                container &&
                !container.contains(event.target as Node)
            ) {
                isOpen = false;
            }
        }

        window.addEventListener("click", handleClickOutside);
        return () => window.removeEventListener("click", handleClickOutside);
    });
</script>

<div class="dropdown-container {className}" bind:this={container}>
    <button
        type="button"
        class="dropdown-trigger"
        class:open={isOpen}
        onclick={toggle}
        onkeydown={handleKeydown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
    >
        <div class="trigger-content">
            {#if selectedItem && typeof selectedItem === "object" && selectedItem[iconKey]}
                <span class="item-icon">{selectedItem[iconKey]}</span>
            {/if}
            <span class="trigger-label">
                {selectedItem
                    ? typeof selectedItem === "object"
                        ? selectedItem[labelKey]
                        : selectedItem
                    : placeholder}
            </span>
        </div>
        <ChevronDown size={14} class="chevron {isOpen ? 'rotated' : ''}" />
    </button>

    {#if isOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="dropdown-menu {dropdownClassName}"
            transition:slide={{ duration: 150 }}
            role="listbox"
            onclick={(e) => e.stopPropagation()}
        >
            {#if showSearch}
                <div class="search-wrapper">
                    <Search size={14} class="search-icon" />
                    <input
                        type="text"
                        class="search-input"
                        placeholder={searchPlaceholder}
                        bind:value={searchQuery}
                        onclick={(e) => e.stopPropagation()}
                    />
                </div>
            {/if}

            <div class="items-list">
                {#each filteredItems as item}
                    {@const itemValue =
                        typeof item === "object" ? item[valueKey] : item}
                    {@const itemLabel =
                        typeof item === "object" ? item[labelKey] : item}
                    <button
                        type="button"
                        class="item-option"
                        class:selected={itemValue === value}
                        onclick={() => select(item)}
                        role="option"
                        aria-selected={itemValue === value}
                    >
                        <div class="item-info">
                            <div class="item-main">
                                {#if typeof item === "object" && item[iconKey]}
                                    <span class="item-icon"
                                        >{item[iconKey]}</span
                                    >
                                {/if}
                                <span class="item-label">{itemLabel}</span>
                            </div>
                            {#if typeof item === "object" && item[descriptionKey]}
                                <span class="item-description"
                                    >{item[descriptionKey]}</span
                                >
                            {/if}
                        </div>
                        {#if itemValue === value}
                            <span class="selected-indicator">✓</span>
                        {/if}
                    </button>
                {/each}
                {#if filteredItems.length === 0}
                    <div class="no-results">No items found</div>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    .dropdown-container {
        position: relative;
        display: inline-block;
        min-width: 120px;
    }

    .dropdown-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        width: 100%;
        padding: 0.375rem 0.75rem;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        color: inherit;
        font-family: inherit;
        font-size: 0.8125rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
        outline: none;
    }

    .dropdown-trigger:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: rgba(255, 255, 255, 0.15);
    }

    .dropdown-trigger.open {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .trigger-content {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        overflow: hidden;
    }

    .trigger-label {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .chevron {
        transition: transform 0.2s ease;
        opacity: 0.6;
        flex-shrink: 0;
    }

    .chevron.rotated {
        transform: rotate(180deg);
    }

    .dropdown-menu {
        position: absolute;
        bottom: calc(100% + 0.5rem);
        left: 0;
        width: 100%;
        min-width: 200px;
        background: rgba(30, 30, 30, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        z-index: 9999;
        overflow: hidden;
        backdrop-filter: blur(16px);
    }

    .search-wrapper {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }

    .search-icon {
        opacity: 0.4;
        flex-shrink: 0;
    }

    .search-input {
        width: 100%;
        background: transparent;
        border: none;
        color: white;
        font-size: 0.75rem;
        outline: none;
    }

    .items-list {
        max-height: 250px;
        overflow-y: auto;
        padding: 0.25rem;
    }

    .item-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0.625rem 0.75rem;
        background: transparent;
        border: none;
        border-radius: 6px;
        color: rgba(255, 255, 255, 0.82);
        font-family: inherit;
        font-size: 0.8125rem;
        text-align: left;
        cursor: pointer;
        transition: all 0.15s ease;
        line-height: 1.4;
        height: auto !important; /* CRITICAL: Prevent VS Code button height override */
        min-height: 2.5rem;
    }

    .item-option:hover {
        background: rgba(255, 255, 255, 0.1);
        color: white;
    }

    .item-option.selected {
        background: rgba(59, 130, 246, 0.18);
        color: #3b82f6;
    }

    .item-info {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        flex: 1;
        overflow: hidden;
        padding: 2px 0;
    }

    .item-main {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 600;
    }

    .item-description {
        font-size: 0.6875rem;
        opacity: 0.55;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .selected-indicator {
        font-weight: bold;
        color: var(--color-primary);
        margin-left: 0.5rem;
    }

    .no-results {
        padding: 1.25rem;
        text-align: center;
        font-size: 0.75rem;
        opacity: 0.4;
    }

    /* Scrollbar */
    .items-list::-webkit-scrollbar {
        width: 5px;
    }
    .items-list::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.12);
        border-radius: 10px;
    }
</style>
