<script lang="ts">
  import { onMount } from "svelte";
  import { extensionSync } from "../../lib/extensionSync";
  import type {
    ChatSession,
    SessionGroup,
    SessionActionPayload,
  } from "../../lib/types/session";
  import SidebarHeader from "./SidebarHeader.svelte";
  import SessionList from "./SessionList.svelte";
  import Modal from "../ui/Modal.svelte";

  let { onaction, oncloseSidebar } = $props<{
    onaction?: (payload: any) => void;
    oncloseSidebar?: () => void;
  }>();

  let sessionGroups = $state<SessionGroup[]>([]);
  let activeSessionId = $state<string | null>(null);
  let searchQuery = $state("");
  let isLoading = $state(true);
  let isClearModalOpen = $state(false);

  let debounceTimer: any;

  onMount(() => {
    extensionSync.send("refreshSessions", {});
    const controller = new AbortController();
    window.addEventListener("message", handleMessage, {
      signal: controller.signal,
    });
    return () => controller.abort();
  });

  function handleMessage(event: MessageEvent) {
    const message = event.data;
    if (message.type === "sessionsUpdate") {
      sessionGroups = message.groups;
      activeSessionId = message.activeSessionId;
      isLoading = false;
    }
  }

  function handleNewChat() {
    extensionSync.send("newSession", {});
  }

  function handleSessionClick(sessionId: string) {
    extensionSync.send("switchSession", { sessionId });
  }

  function handleSessionAction(payload: SessionActionPayload) {
    performAction(payload);
  }

  function performAction(detail: SessionActionPayload) {
    const { action, sessionId, payload } = detail;
    extensionSync.send("sessionAction", {
      action,
      sessionId,
      payload,
    });
  }

  function handleSearch(query: string) {
    searchQuery = query;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      extensionSync.send("searchSessions", {
        query: searchQuery,
      });
    }, 350);
  }

  function handleClearAll() {
    isClearModalOpen = true;
  }

  function confirmClearAll() {
    performAction({
      action: "clearAll",
      sessionId: "",
      payload: {},
    });
    isClearModalOpen = false;
  }

  function cancelClearAll() {
    isClearModalOpen = false;
  }

  const filteredGroups = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === "") return sessionGroups;

    return sessionGroups
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((s) =>
          s.title.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.sessions.length > 0);
  });
</script>

<div class="session-sidebar">
  <SidebarHeader
    {searchQuery}
    onsearch={handleSearch}
    onnewChat={handleNewChat}
    onclearAll={handleClearAll}
    {oncloseSidebar}
  />

  <SessionList
    {filteredGroups}
    {activeSessionId}
    {isLoading}
    {searchQuery}
    onswitchSession={handleSessionClick}
    onsessionAction={handleSessionAction}
    onnewChat={handleNewChat}
  />

  <Modal
    bind:isOpen={isClearModalOpen}
    title="Clear History"
    message="Are you sure you want to delete all chat sessions? This action cannot be undone."
    confirmText="Clear All"
    type="danger"
    onconfirm={confirmClearAll}
    oncancel={cancelClearAll}
  />
</div>

<style>
  .session-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: rgba(18, 18, 18, 0.98);
    backdrop-filter: blur(20px);
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }
</style>
