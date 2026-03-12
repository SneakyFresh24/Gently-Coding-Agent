<script lang="ts">
  import { onMount } from "svelte";
  import { settingsStore } from "./stores/settingsStore";
  import { contextStore } from "./stores/contextStore";
  import { taskStore } from "./stores/taskStore";
  import { extensionSync } from "./lib/extensionSync";
  import { extensionEvents } from "./lib/extensionEvents";
  import GuardianView from "./views/GuardianView.svelte";
  import SetupView from "./components/setup/SetupView.svelte";
  import ChatLayout from "./components/layout/ChatLayout.svelte";

  let viewType = $state((window as any).initialState?.viewType || 'chat');
  let hasApiKey = $state(false);
  let isChecking = $state(true);
  let initializationError = $state<string | null>(null);

  onMount(() => {
    console.log(`[Gently] App mounted (viewType: ${viewType})`);

    // Hydrate settings from localStorage
    settingsStore.hydrate();

    // Init bridge
    const cleanup = extensionEvents.init({
      onApiKeyStatus: (status: any) => {
        hasApiKey = status.hasKey;
        isChecking = false;
        if (status.agentMode !== undefined)
          settingsStore.setAgentMode(status.agentMode);
        if (status.selectedModel !== undefined)
          settingsStore.setSelectedModel(status.selectedModel);
        if (status.selectedMode !== undefined)
          settingsStore.setSelectedMode(status.selectedMode);
      },
      onModelsList: (models: any[]) => {
        settingsStore.setAvailableModels(models);
      },
      onContextUpdate: (files: any[], stats: any) => {
        contextStore.updateContext(files, stats);
      },
      onRestoreSession: (data: any) => {
        console.log("[Gently] Restoring Session Tasks and Context.");
        if (data.tasks) {
          taskStore.hydrateTasks(
            data.tasks.plans || [],
            data.tasks.currentPlanId,
          );
        }
        if (data.context) {
          contextStore.hydrateContext(
            data.context.files || [],
            data.context.stats,
          );
        }
      },
    });

    // Request initial data via sync
    try {
      extensionSync.send("fetchModels", {});
      extensionSync.send("ready", {});
    } catch (err) {
      console.error("[Gently] Initialization failed", err);
      initializationError =
        "Failed to connect to the extension. Please reload.";
    }

    return cleanup;
  });
</script>

<main
  class="w-full h-full overflow-hidden"
  aria-label="Gently Chat Application"
>
  {#if viewType === 'guardian'}
    <div class="animate-fade-in w-full h-full">
      <GuardianView />
    </div>
  {:else if isChecking}
    <div
      class="flex flex-col items-center justify-center w-full h-full"
      role="status"
      aria-live="polite"
    >
      <div class="animate-pulse text-lg mb-4">Loading Gently...</div>
      {#if initializationError}
        <div
          class="text-sm text-red-400 bg-red-900/20 px-4 py-2 border border-red-500/30 rounded-lg"
        >
          {initializationError}
        </div>
      {/if}
    </div>
  {:else if !hasApiKey}
    <div class="animate-fade-in w-full h-full">
      <SetupView />
    </div>
  {:else}
    <div class="animate-fade-in w-full h-full">
      <ChatLayout />
    </div>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
  }
</style>
