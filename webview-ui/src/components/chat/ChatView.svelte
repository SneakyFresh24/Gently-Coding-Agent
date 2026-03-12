<script lang="ts">
  import { onMount } from "svelte";
  import { chatActions } from "../../lib/chatActions";
  import { extensionEvents } from "../../lib/extensionEvents";
  import { chatStore } from "../../stores/chatStore";
  import { settingsStore } from "../../stores/settingsStore";

  // Components
  import TabHeader from "../layout/TabHeader.svelte";
  import TaskView from "../task/TaskView.svelte";
  import ContextPanel from "../context/ContextPanel.svelte";
  import StatusIndicator from "../ui/StatusIndicator.svelte";
  import MessageList from "./MessageList.svelte";
  import ChatInputArea from "./ChatInputArea.svelte";
  import ChatToolbar from "./ChatToolbar.svelte";
  import ChatOverlays from "./ChatOverlays.svelte";
  import ErrorBanner from "./ErrorBanner.svelte";

  import type { FileReference } from "../../stores/chatStore";

  interface Props {
    showSidebar: boolean;
    onopenSidebar: () => void;
  }

  let { showSidebar = true, onopenSidebar }: Props = $props();

  let message = $state("");
  let activeTab = $state<"thread" | "task" | "context">("thread");
  let pendingFileReferences = $state<FileReference[]>([]);
  let messageList = $state<MessageList | null>(null);

  let selectedMode = $derived($settingsStore.selectedMode);
  let error = $derived($chatStore.error);

  function handleSendRune(data: {
    message: string;
    fileReferences: FileReference[];
  }) {
    chatActions.sendMessage(data.message, data.fileReferences);
    messageList?.forceScrollToBottom();
  }

  function enhancePrompt() {
    if (!message.trim()) return;
    chatActions.enhancePrompt(message.trim());
  }

  onMount(() => {
    return extensionEvents.init({
      onPromptUpdate: (p) => (message = p),
      onTabChange: (t) => (activeTab = t),
      onFileRefAdd: (f) =>
        (pendingFileReferences = [...pendingFileReferences, f]),
    });
  });
</script>

<div class="chat-container">
  <TabHeader bind:activeTab {showSidebar} {onopenSidebar} />

  {#if activeTab === "thread"}
    {#if error}
      <ErrorBanner {error} />
    {/if}

    <MessageList
      bind:this={messageList}
      messages={$chatStore.messages}
      {selectedMode}
    />
  {:else if activeTab === "task"}
    <TaskView />
  {:else if activeTab === "context"}
    <div class="context-view">
      <ContextPanel />
    </div>
  {/if}

  <StatusIndicator />

  {#if activeTab === "thread"}
    <div class="input-section">
      <ChatToolbar
        {selectedMode}
        messageLength={message.trim().length}
        onenhancePrompt={enhancePrompt}
      />

      <ChatInputArea
        bind:message
        bind:pendingFileReferences
        {selectedMode}
        onsend={handleSendRune}
      />
    </div>
  {/if}
</div>

<ChatOverlays />

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .context-view {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }

  .input-section {
    display: flex;
    flex-direction: column;
    background: rgba(30, 30, 38, 0.4);
    backdrop-filter: blur(20px);
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 1.5rem 1.5rem 0 0;
    margin-top: auto;
    box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.4);
    /* overflow: hidden removed to allow dropdowns to display upwards */
  }

  /* Force stacking order for inputs and toolbar */
  :global(.input-area) {
    z-index: 10 !important;
  }

  :global(.bottom-bar) {
    z-index: 1000 !important;
  }
</style>
