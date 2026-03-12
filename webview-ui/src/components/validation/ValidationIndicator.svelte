<script lang="ts">
  import { validationStore } from "../../stores/validationStore";
  import { CheckCircle2, AlertCircle, Loader2 } from "lucide-svelte";

  interface Props {
    onshowErrors?: () => void;
  }

  let { onshowErrors }: Props = $props();

  let state = $derived($validationStore);
  let showBadge = $derived(state.status !== "idle");

  function handleClick() {
    if (state.status === "error") {
      if (onshowErrors) onshowErrors();
    }
  }

  function formatDuration(ms: number | null): string {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

{#if showBadge}
  <button
    class="validation-badge {state.status}"
    class:clickable={state.status === "error"}
    onclick={handleClick}
    title={state.status === "error" ? "Click to view errors" : ""}
    aria-label="Validation status: {state.status}"
    type="button"
  >
    {#if state.status === "validating"}
      <Loader2 size={14} class="icon spinning" />
      <span class="text"
        >Validating{state.retries > 0
          ? ` (retry ${state.retries})`
          : ""}...</span
      >
    {:else if state.status === "success"}
      <CheckCircle2 size={14} class="icon" />
      <span class="text">✓ Validated</span>
      {#if state.duration}
        <span class="duration">{formatDuration(state.duration)}</span>
      {/if}
    {:else if state.status === "error"}
      <AlertCircle size={14} class="icon" />
      <span class="text"
        >⚠ {state.errors.length} error{state.errors.length !== 1
          ? "s"
          : ""}</span
      >
    {/if}
  </button>
{/if}

<style>
  .validation-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: all 0.2s ease;
    cursor: default;
    background: transparent;
    font-family: inherit;
  }

  .validation-badge.clickable {
    cursor: pointer;
  }

  .validation-badge.clickable:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* Validating State */
  .validation-badge.validating {
    background: linear-gradient(
      135deg,
      rgba(0, 122, 255, 0.15),
      rgba(0, 122, 255, 0.08)
    );
    border-color: rgba(0, 122, 255, 0.3);
    color: #007aff;
  }

  /* Success State */
  .validation-badge.success {
    background: linear-gradient(
      135deg,
      rgba(0, 200, 83, 0.15),
      rgba(0, 200, 83, 0.08)
    );
    border-color: rgba(0, 200, 83, 0.3);
    color: #00c853;
  }

  /* Error State */
  .validation-badge.error {
    background: linear-gradient(
      135deg,
      rgba(255, 59, 48, 0.15),
      rgba(255, 59, 48, 0.08)
    );
    border-color: rgba(255, 59, 48, 0.3);
    color: #ff3b30;
  }

  .icon {
    flex-shrink: 0;
  }

  .icon.spinning {
    animation: spin 1s linear infinite;
  }

  .text {
    white-space: nowrap;
  }

  .duration {
    opacity: 0.7;
    font-size: 11px;
    margin-left: 4px;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
