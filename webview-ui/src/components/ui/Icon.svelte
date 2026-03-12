<script lang="ts">
    import * as Icons from "lucide-svelte";
    import type { ComponentType } from "svelte";

    export let name: string | null = null;
    export let emoji: string | null = null;
    export let size: number = 16;
    export let color: string = "currentColor";
    export let className: string = "";

    $: IconComponent = name ? ((Icons as any)[name] as ComponentType) : null;
</script>

{#if IconComponent}
    <svelte:component
        this={IconComponent}
        {size}
        {color}
        class={className}
        aria-hidden="true"
    />
{:else if emoji}
    <span
        class="icon-emoji {className}"
        style:font-size="{size}px"
        aria-hidden="true"
    >
        {emoji}
    </span>
{/if}

<style>
    .icon-emoji {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        user-select: none;
    }
</style>
