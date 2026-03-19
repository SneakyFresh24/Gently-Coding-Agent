<script lang="ts">
  import { onMount } from 'svelte';
  import ChatLayout from './ChatLayout.svelte';
  import TaskHeader from './TaskHeader.svelte';
  import WelcomeSection from './WelcomeSection.svelte';
  import MessagesArea from './MessagesArea.svelte';
  import InputSection from './InputSection.svelte';
  import AutoApproveBar from '../approval/AutoApproveBar.svelte';
  import ModelDropdown from '../layout/ModelDropdown.svelte';

  import { extensionStore, isBusy, hasTask } from '../../stores/extensionStore';
  import { chatStore, isStreaming } from '../../stores/chatStore';
  import { settingsStore } from '../../stores/settingsStore';
  import { init as initMessaging } from '../../lib/messaging';

  let { isHidden = false } = $props();

  onMount(() => {
    initMessaging({
      // State & lifecycle
      onApiKeyStatus: (data) => settingsStore.setApiKeyStatus(data.hasKey),
      onModelsList: (data) => settingsStore.setModels(data.models),
      onModeChanged: (data) => {
        extensionStore.hydrate({
          mode: data.modeId,
        });
      },
      onError: (data) => chatStore.setError(data.message),

      // Messages
      onAssistantMessage: (data) => {
        if (data.isStreaming) {
          chatStore.appendChunk(data);
        } else {
          chatStore.addMessage({
            id: data.id,
            role: 'assistant',
            content: data.content,
            timestamp: data.timestamp || Date.now(),
            toolCalls: data.toolCalls,
            checkpoint: data.checkpoint,
          });
        }
      },
      onUserMessage: (data) => {
        chatStore.addMessage({
          id: data.id,
          role: 'user',
          content: data.content,
          timestamp: data.timestamp || Date.now(),
          fileReferences: data.fileReferences,
        });
      },
      onAssistantMessageEnd: (data) => chatStore.completeStreaming(data),
      onSystemMessage: (data) => {
        chatStore.addMessage({
          id: data.messageId || `sys_${Date.now()}`,
          role: 'system',
          content: data.content,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
      },
      onLoadMessages: (data) => chatStore.hydrateMessages(data.messages),
      onClearMessages: () => chatStore.clear(),

      // Generation state
      onGeneratingStart: () => extensionStore.setStreaming(true),
      onGeneratingEnd: () => extensionStore.setStreaming(false),
      onProcessingStart: () => extensionStore.setProcessing(true),
      onProcessingEnd: () => extensionStore.setProcessing(false),

      // Context
      onContextUpdate: (_data) => {
        // Could update a context store if needed
      },

      // Auto-approve
      onAutoApproveSettingsUpdate: (data) => {
        extensionStore.hydrate({
          autoApprovalSettings: data.settings,
        });
      },

      // Prompt from Guardian
      onSetPromptFromGuardian: (data) => {
        chatStore.setInputValue(data.prompt);
      },

      // Unhandled
      onUnhandled: (data) => {
        console.log('[ChatView] Unhandled message:', data.type);
      },
    });
  });
</script>

<ChatLayout {isHidden}>
  <div class="chat-container">
    {#if $chatStore.messages.length > 0 || $hasTask}
      <TaskHeader task={$extensionStore.currentTask} />
      <MessagesArea messages={$chatStore.messages} />
    {:else}
      <WelcomeSection />
    {/if}
  </div>

  <footer class="chat-footer">
    <div class="footer-toolbar">
      <AutoApproveBar />
      <ModelDropdown 
        selectedModel={$settingsStore.selectedModel} 
        models={$settingsStore.availableModels} 
      />
    </div>
    <InputSection
      isBusy={$isBusy}
      isStreamingProp={$isStreaming}
      inputValue={$chatStore.inputValue}
      selectedFiles={$chatStore.selectedFiles}
      onInputChange={(v) => chatStore.setInputValue(v)}
      onSend={() => chatStore.sendMessage()}
      onCancel={() => chatStore.cancelTask()}
      onAddFile={(f) => chatStore.addFile(f)}
      onRemoveFile={(f) => chatStore.removeFile(f)}
    />
  </footer>
</ChatLayout>

<style>
  .chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .chat-footer {
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    padding: 0;
  }

  .footer-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
  }
</style>
