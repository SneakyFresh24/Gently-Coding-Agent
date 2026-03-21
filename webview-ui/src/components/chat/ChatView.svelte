<script lang="ts">
  import { onMount } from 'svelte';
  import ChatLayout from './ChatLayout.svelte';
  import TaskHeader from './TaskHeader.svelte';
  import WelcomeSection from './WelcomeSection.svelte';
  import MessagesArea from './MessagesArea.svelte';
  import InputSection from './InputSection.svelte';
  import AutoApproveBar from '../approval/AutoApproveBar.svelte';
  import ToolApprovalModal from '../approval/ToolApprovalModal.svelte';
  import ModelDropdown from '../layout/ModelDropdown.svelte';
  import ErrorBoundary from '../ui/ErrorBoundary.svelte';
  import LoadingIndicator from '../ui/LoadingIndicator.svelte';
  import ScreenReaderAnnouncer from '../ui/ScreenReaderAnnouncer.svelte';


  import { extensionStore, isBusy, hasTask } from '../../stores/extensionStore';
  import { chatStore, isStreaming, mentionState, taskProgressState } from '../../stores/chatStore';
  import { settingsStore } from '../../stores/settingsStore';
  import { historyStore } from '../../stores/historyStore';
  import { init as initMessaging } from '../../lib/messaging';


  let { isHidden = false } = $props();
  let announcement = $state('');

  function announce(message: string) {
    announcement = '';
    queueMicrotask(() => {
      announcement = message;
    });
  }

  function closeBoundaryError() {
    chatStore.clearError();
  }

  function retryBoundaryError() {
    chatStore.retryLastMessage();
  }

  onMount(() => {
    initMessaging({
      // State & lifecycle
      onApiKeyStatus: (data) => settingsStore.setApiKeyStatus(data.hasKey),
      onModelsList: (data) => settingsStore.setModels(data.models),
      onModelChanged: (data) => settingsStore.setSelectedModel(data.model || ''),
      onRetryingWithReducedTokens: (data) => {
        chatStore.setRetrying(true);
        chatStore.addMessage({
          id: `sys_retry_${Date.now()}`,
          role: 'system',
          content: `Retrying with reduced output tokens (${data.originalMax} -> ${data.newMax})...`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
        announce('Retrying request with reduced tokens');
      },
      onRetryingRateLimit: (data) => {
        chatStore.setRetrying(true);
        chatStore.addMessage({
          id: `sys_rate_retry_${Date.now()}`,
          role: 'system',
          content: `Provider busy, retrying (${data.attempt}/${data.maxAttempts}) in ${Math.ceil(data.delayMs / 1000)}s...`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
        announce('Provider busy, retrying request');
      },
      onModeChanged: (data) => {
        extensionStore.hydrate({
          mode: data.modeId,
        });
      },
      onError: (data) => {
        chatStore.setError(data.message, data.requestId);
        announce('Chat error. Retry is available.');
      },

      // Messages
      onAssistantMessage: (data) => {
        chatStore.setRetrying(false);
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
        announce('Message sent');
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
      onAddFileReference: (data) => {
        const path = data.fileReference?.path;
        if (path) {
          chatStore.addFile(path);
          announce('File added to context');
        }
      },
      onFileSearchResults: (data) => {
        chatStore.setMentionResults(data.results || []);
      },

      // Generation state
      onGeneratingStart: () => extensionStore.setStreaming(true),
      onGeneratingEnd: () => {
        extensionStore.setStreaming(false);
        extensionStore.setPendingApproval(null);
        chatStore.setRetrying(false);
        announce('Response complete');
      },
      onProcessingStart: () => extensionStore.setProcessing(true),
      onProcessingEnd: () => {
        extensionStore.setProcessing(false);
        extensionStore.setPendingApproval(null);
      },

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

      // Tool Approvals
      onToolApprovalRequest: (data) => {
        extensionStore.setPendingApproval(data);
      },

      // Tasks
      onTaskStart: (data) => {
        extensionStore.setCurrentTask({ id: data.taskId, text: data.taskName, ts: Date.now() });
        chatStore.updateTaskProgress({ label: data.taskName, text: data.taskName });
        announce('Task started');
      },
      onTaskUpdate: (_data) => {
        // Progress update placeholder
      },
      onTaskComplete: (msg) => {
        extensionStore.setCurrentTask(null);
        chatStore.clearTaskProgress();
        announce('Task completed');
      },

      onTaskProgress: (msg) => {
        chatStore.updateTaskProgress({
          label: msg.label,
          progress: typeof msg.progress === 'number' ? msg.progress : undefined,
          text: msg.label,
        });
      },

      // Sessions
      onSessionsUpdate: (data) => {
        historyStore.handleSessionsUpdate(data);
      },
      onRefreshSessions: () => {
        historyStore.fetchHistory();
      },

      // Unhandled

      onUnhandled: (data) => {
        console.log('[ChatView] Unhandled message:', data.type);
      },
    });
  });
</script>

<ChatLayout {isHidden}>
  <ErrorBoundary
    hasError={!!$chatStore.error}
    errorMessage={$chatStore.error?.message || 'Unknown chat error'}
    requestId={$chatStore.error?.requestId || ''}
    onRetry={retryBoundaryError}
    onReset={closeBoundaryError}
  >
    <div class="chat-container">
      {#if $chatStore.messages.length > 0 || $hasTask}
        <TaskHeader task={$extensionStore.currentTask} progress={$taskProgressState} />
        <MessagesArea messages={$chatStore.messages} />
      {:else}
        <WelcomeSection />
      {/if}
    </div>
  </ErrorBoundary>

  <footer class="chat-footer">
    <div class="footer-toolbar">
      <AutoApproveBar />
      {#if $chatStore.loading.isRetrying}
        <LoadingIndicator label="Retrying request" size="sm" />
      {/if}
      <ModelDropdown 
        selectedModel={$settingsStore.selectedModel} 
        models={$settingsStore.availableModels} 
      />
    </div>
    <InputSection
      isBusy={$isBusy}
      isStreamingProp={$isStreaming}
      hasModel={!!$settingsStore.selectedModel}
      inputValue={$chatStore.inputValue}
      selectedFiles={$chatStore.selectedFiles}
      mentionState={$mentionState}
      onInputChange={(v) => chatStore.setInputValue(v)}
      onSend={() => chatStore.sendMessage()}
      onCancel={() => chatStore.cancelTask()}
      onAddFile={(f) => chatStore.addFile(f)}
      onRemoveFile={(f) => chatStore.removeFile(f)}
      onMentionContextChange={(atIndex, cursorPosition, query) => chatStore.setMentionContext(atIndex, cursorPosition, query)}
      onCloseMention={() => chatStore.closeMentionMenu()}
    />
  </footer>
</ChatLayout>

<ToolApprovalModal />
<ScreenReaderAnnouncer message={announcement} />


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
