<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import ChatLayout from './ChatLayout.svelte';
  import TaskHeader from './TaskHeader.svelte';
  import WelcomeSection from './WelcomeSection.svelte';
  import MessagesArea from './MessagesArea.svelte';
  import InputSection from './InputSection.svelte';
  import AutoApproveBar from '../approval/AutoApproveBar.svelte';
  import ToolApprovalModal from '../approval/ToolApprovalModal.svelte';
  import ModelDropdown from '../layout/ModelDropdown.svelte';


  import { extensionStore, isBusy, hasTask } from '../../stores/extensionStore';
  import { chatStore, isStreaming } from '../../stores/chatStore';
  import { settingsStore } from '../../stores/settingsStore';
  import { historyStore } from '../../stores/historyStore';
  import { init as initMessaging } from '../../lib/messaging';


  let { isHidden = false } = $props();

  function inferPhase(label: string | null | undefined): 'idle' | 'sending' | 'thinking' | 'tooling' {
    const normalized = (label || '').toLowerCase();
    if (!normalized) return 'idle';
    if (normalized.includes('sending')) return 'sending';
    if (normalized.includes('reading') || normalized.includes('tool') || normalized.includes('preparing')) return 'tooling';
    if (normalized.includes('thinking') || normalized.includes('denkt') || normalized.includes('analy')) return 'thinking';
    return 'thinking';
  }

  onMount(() => {
    initMessaging({
      // State & lifecycle
      onApiKeyStatus: (data) => settingsStore.setApiKeyStatus(data.hasKey),
      onModelsList: (data) => settingsStore.setModels(data.models),
      onModelChanged: (data) => settingsStore.setSelectedModel(data.model || ''),
      onRetryingWithReducedTokens: (data) => {
        chatStore.addMessage({
          id: `sys_retry_${Date.now()}`,
          role: 'system',
          content: `Retrying with reduced output tokens (${data.originalMax} -> ${data.newMax})...`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
      },
      onRetryingRateLimit: (data) => {
        chatStore.addMessage({
          id: `sys_rate_retry_${Date.now()}`,
          role: 'system',
          content: `Provider busy, retrying (${data.attempt}/${data.maxAttempts}) in ${Math.ceil(data.delayMs / 1000)}s...`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
      },
      onRetryStatus: (data) => {
        const fixes = Array.isArray(data.fixes) && data.fixes.length > 0
          ? ` Fixes: ${data.fixes.slice(0, 2).join('; ')}`
          : '';
        chatStore.addMessage({
          id: `sys_sequence_retry_${Date.now()}`,
          role: 'system',
          content: `Repairing conversation (${data.attempt}/${data.maxAttempts}) in ${Math.ceil(data.delayMs / 1000)}s...${fixes}`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
      },
      onModeChanged: (data) => {
        extensionStore.hydrate({
          mode: data.modeId,
        });
      },
      onError: (data) => {
        chatStore.setError(data.message);
        extensionStore.clearActivityState();
        extensionStore.setProcessing(false);
      },

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
      onGeneratingStart: () => {
        extensionStore.setStreaming(true);
        if (!get(extensionStore).activityLabel) {
          extensionStore.setActivityLabel('Thinking...');
          extensionStore.setActivityPhase('thinking');
        }
      },
      onGeneratingEnd: () => {
        extensionStore.setStreaming(false);
        extensionStore.setPendingApproval(null);
        extensionStore.clearActivityState();
      },
      onProcessingStart: () => {
        extensionStore.setProcessing(true);
      },
      onProcessingEnd: () => {
        extensionStore.setProcessing(false);
        extensionStore.setPendingApproval(null);
        if (!get(extensionStore).isStreaming) {
          extensionStore.clearActivityState();
        }
      },

      // Context
      onContextUpdate: (_data) => {},
      onActivityUpdate: (data) => {
        extensionStore.setActivityLabel(data.label ?? null);
        extensionStore.setActivityPhase(inferPhase(data.label));
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
      onToolExecutionStart: (data) => {
        const toolName = data.toolName || 'tool';
        const toolId = data.toolId || `${toolName}-${Date.now()}`;
        extensionStore.upsertActiveToolCall({
          toolId,
          toolName,
          file: data.file || data.path,
          status: 'running',
          startedAt: Number(data.timestamp || Date.now()),
        });
        extensionStore.setActivityPhase('tooling');
      },
      onToolComplete: (data) => {
        const toolName = data.tool || data.toolName || 'tool';
        const state = get(extensionStore);
        const exact = data.toolId && state.activeToolCalls.find((t) => t.toolId === data.toolId);
        if (exact) {
          extensionStore.removeActiveToolCall(exact.toolId);
          return;
        }
        const candidate = [...state.activeToolCalls].reverse().find((t) => t.toolName === toolName);
        if (candidate) {
          extensionStore.removeActiveToolCall(candidate.toolId);
        }
      },

      // Tasks
      onTaskStart: (data) => {
        extensionStore.setCurrentTask({ id: data.taskId, text: data.taskName, ts: Date.now() });
      },
      onTaskUpdate: (_data) => {
        // Progress update placeholder
      },
      onTaskComplete: (msg) => {
        extensionStore.setCurrentTask(null);
      },

      onTaskProgress: (msg) => {
        // You could update a progress store or just log it
        console.log('[ChatView] Task Progress:', msg.label);
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
      hasModel={!!$settingsStore.selectedModel}
      inputValue={$chatStore.inputValue}
      selectedFiles={$chatStore.selectedFiles}
      activityLabel={$extensionStore.activityLabel}
      activityPhase={$extensionStore.activityPhase}
      activeToolCalls={$extensionStore.activeToolCalls}
      onInputChange={(v) => chatStore.setInputValue(v)}
      onSend={() => chatStore.sendMessage()}
      onCancel={() => chatStore.cancelTask()}
      onAddFile={(f) => chatStore.addFile(f)}
      onRemoveFile={(f) => chatStore.removeFile(f)}
    />
  </footer>
</ChatLayout>

<ToolApprovalModal />


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
