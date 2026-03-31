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
  import Modal from '../ui/Modal.svelte';
  import ModelDropdown from '../layout/ModelDropdown.svelte';
  import ModeToggle from '../layout/ModeToggle.svelte';


  import { extensionStore, isBusy, hasTask } from '../../stores/extensionStore';
  import { chatStore, isStreaming } from '../../stores/chatStore';
  import { settingsStore } from '../../stores/settingsStore';
  import { historyStore } from '../../stores/historyStore';
  import { init as initMessaging } from '../../lib/messaging';


  let { isHidden = false } = $props();
  let checkpointDiffModalOpen = $state(false);
  let checkpointDiffFiles = $state<any[]>([]);
  let checkpointDiffFrom = $state('');
  let checkpointDiffTo = $state<string | undefined>(undefined);

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
      onMessagesCompressed: (data) => {
        chatStore.handleCompression({
          remainingMessages: data.remainingMessages || [],
          droppedCount: Number(data.droppedCount || 0),
          summaryInserted: Boolean(data.summaryInserted)
        });
        chatStore.addMessage({
          id: `sys_compression_${Date.now()}`,
          role: 'system',
          content: `${data.droppedCount || 0} messages compressed${data.summaryInserted ? ' (summary inserted)' : ''}.`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
      },

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
      onCheckpointRestored: (data) => {
        const prunedInfo = typeof data.messagesPruned === 'number' ? `, pruned ${data.messagesPruned} messages` : '';
        chatStore.addMessage({
          id: `sys_checkpoint_restored_${Date.now()}`,
          role: 'system',
          content: `Checkpoint restored (${data.mode || 'files'}): ${data.filesRestored?.length || 0} files${prunedInfo}.`,
          timestamp: Date.now(),
          isSystemMessage: true
        });
      },
      onCheckpointRestorePlanned: (data) => {
        chatStore.addMessage({
          id: `sys_checkpoint_restore_planned_${Date.now()}`,
          role: 'system',
          content: `Restoring checkpoint (${data.mode || 'files'})...`,
          timestamp: Date.now(),
          isSystemMessage: true
        });
      },
      onCheckpointRestoreError: (data) => {
        chatStore.addMessage({
          id: `sys_checkpoint_restore_error_${Date.now()}`,
          role: 'system',
          content: `Checkpoint restore failed: ${data.error || 'Unknown error'}`,
          timestamp: Date.now(),
          isSystemMessage: true
        });
      },
      onCheckpointDiffReady: (data) => {
        const fileCount = Array.isArray(data.files) ? data.files.length : 0;
        checkpointDiffFiles = Array.isArray(data.files) ? data.files : [];
        checkpointDiffFrom = data.fromCheckpointId || '';
        checkpointDiffTo = data.toCheckpointId;
        checkpointDiffModalOpen = true;
        chatStore.addMessage({
          id: `sys_checkpoint_diff_${Date.now()}`,
          role: 'system',
          content: `Checkpoint diff ready: ${fileCount} changed files.`,
          timestamp: Date.now(),
          isSystemMessage: true
        });
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
      <MessagesArea messages={$chatStore.messages} resetEpoch={$chatStore.messageEpoch} />
    {:else}
      <WelcomeSection />
    {/if}
  </div>

  <footer class="chat-footer">
    <div class="footer-toolbar">
      <AutoApproveBar />
      <ModeToggle mode={$extensionStore.mode} />
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
<Modal
  isOpen={checkpointDiffModalOpen}
  title="Checkpoint Diff"
  onClose={() => {
    checkpointDiffModalOpen = false;
  }}
>
  <div class="checkpoint-diff-meta">
    <div><strong>From:</strong> {checkpointDiffFrom || 'unknown'}</div>
    <div><strong>To:</strong> {checkpointDiffTo || 'working tree'}</div>
    <div><strong>Files:</strong> {checkpointDiffFiles.length}</div>
  </div>
  <div class="checkpoint-diff-files">
    {#if checkpointDiffFiles.length === 0}
      <div class="checkpoint-diff-empty">No changed files.</div>
    {:else}
      {#each checkpointDiffFiles as file}
        <div class="checkpoint-diff-file">
          <div class="checkpoint-diff-file-header">
            <span class="checkpoint-diff-status">{file.status}</span>
            <span class="checkpoint-diff-path">{file.relativePath}</span>
          </div>
          {#if Array.isArray(file.hunks) && file.hunks.length > 0}
            {#each file.hunks as hunk}
              <pre class="checkpoint-diff-hunk">{hunk.content}</pre>
            {/each}
          {:else}
            <div class="checkpoint-diff-empty">No hunks available.</div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</Modal>


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

  .checkpoint-diff-meta {
    display: grid;
    gap: 6px;
    font-size: 12px;
    margin-bottom: 12px;
  }

  .checkpoint-diff-files {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .checkpoint-diff-file {
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    overflow: hidden;
  }

  .checkpoint-diff-file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
  }

  .checkpoint-diff-status {
    font-weight: 700;
    min-width: 18px;
  }

  .checkpoint-diff-path {
    word-break: break-all;
  }

  .checkpoint-diff-hunk {
    margin: 0;
    padding: 10px;
    border-top: 1px solid var(--vscode-panel-border);
    background: var(--vscode-textCodeBlock-background);
    font-family: var(--vscode-editor-font-family);
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .checkpoint-diff-empty {
    padding: 10px;
    font-size: 12px;
    opacity: 0.8;
  }
</style>
