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
  import { init as initMessaging, messaging } from '../../lib/messaging';
  import type { PlanCardState } from '../../lib/types';


  let { isHidden = false } = $props();
  let checkpointDiffModalOpen = $state(false);
  let checkpointDiffFiles = $state<any[]>([]);
  let checkpointDiffFrom = $state('');
  let checkpointDiffTo = $state<string | undefined>(undefined);
  let queryRuntimeContractActive = $state(false);
  const UNHANDLED_SURFACE_WINDOW_MS = 60_000;
  const unhandledStats = new Map<string, {
    count: number;
    firstSeenAt: number;
    lastSeenAt: number;
    lastSurfacedAt: number;
  }>();

  function toPlanCard(plan: any): PlanCardState | null {
    if (!plan || typeof plan !== 'object') return null;
    const steps = Array.isArray(plan.steps)
      ? plan.steps.map((step: any) => ({
        id: String(step?.id || ''),
        description: String(step?.description || ''),
        status: String(step?.status || 'pending'),
        dependencies: Array.isArray(step?.dependencies)
          ? step.dependencies.map((dep: unknown) => String(dep))
          : []
      }))
      : [];

    const planId = String(plan.id || '');
    if (!planId) return null;

    const completedSteps = typeof plan.completedSteps === 'number'
      ? Number(plan.completedSteps)
      : steps.filter((step) => step.status === 'completed').length;

    const pendingApprovalCandidate = plan?.pendingApproval && typeof plan.pendingApproval === 'object'
      ? {
        approvalRequestId: String(plan.pendingApproval.approvalRequestId || ''),
        requestedAt: typeof plan.pendingApproval.requestedAt === 'number' ? Number(plan.pendingApproval.requestedAt) : undefined,
        timeoutMs: typeof plan.pendingApproval.timeoutMs === 'number' ? Number(plan.pendingApproval.timeoutMs) : undefined,
        expiresAt: typeof plan.pendingApproval.expiresAt === 'number' ? Number(plan.pendingApproval.expiresAt) : undefined
      }
      : null;
    const pendingApproval = pendingApprovalCandidate?.approvalRequestId ? pendingApprovalCandidate : null;

    return {
      planId,
      goal: String(plan.goal || ''),
      status: String(plan.status || 'created'),
      schemaVersion: typeof plan.schemaVersion === 'number' ? Number(plan.schemaVersion) : undefined,
      createdAt: typeof plan.createdAt === 'number' ? Number(plan.createdAt) : undefined,
      updatedAt: Date.now(),
      steps,
      completedSteps,
      totalSteps: typeof plan.totalSteps === 'number' ? Number(plan.totalSteps) : steps.length,
      awaitingApproval: String(plan.status || '') === 'awaiting_approval',
      pendingApproval
    };
  }

  function upsertPlanMessage(card: PlanCardState) {
    const messageId = `plan_${card.planId}`;
    const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
    if (existing) {
      chatStore.updateMessage(messageId, {
        role: 'system',
        content: card.goal || 'Plan updated.',
        timestamp: Date.now(),
        isSystemMessage: false,
        planCard: card
      });
      return;
    }

    chatStore.addMessage({
      id: messageId,
      role: 'system',
      content: card.goal || 'Plan created.',
      timestamp: Date.now(),
      isSystemMessage: false,
      planCard: card
    });
  }

  function updatePlanCard(planId: string, updater: (card: PlanCardState) => PlanCardState) {
    const messageId = `plan_${planId}`;
    const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
    if (!existing?.planCard) return;
    chatStore.updateMessage(messageId, {
      planCard: updater(existing.planCard),
      timestamp: Date.now(),
      isSystemMessage: false
    });
  }

  function ensurePlanCardForApproval(
    planId: string,
    goal: string,
    stepsCount = 0,
    pendingApproval?: { approvalRequestId?: string; requestedAt?: number; timeoutMs?: number; expiresAt?: number } | null
  ): boolean {
    const messageId = `plan_${planId}`;
    const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
    if (existing?.planCard) return false;

    chatStore.addMessage({
      id: messageId,
      role: 'system',
      content: goal || 'Plan approval requested.',
      timestamp: Date.now(),
      isSystemMessage: false,
      planCard: {
        planId,
        goal: goal || 'Plan approval requested.',
        status: 'awaiting_approval',
        schemaVersion: undefined,
        createdAt: undefined,
        updatedAt: Date.now(),
        steps: [],
        completedSteps: 0,
        totalSteps: Math.max(0, Number(stepsCount || 0)),
        awaitingApproval: true,
        pendingApproval: pendingApproval?.approvalRequestId
          ? {
            approvalRequestId: String(pendingApproval.approvalRequestId),
            requestedAt: typeof pendingApproval.requestedAt === 'number' ? pendingApproval.requestedAt : undefined,
            timeoutMs: typeof pendingApproval.timeoutMs === 'number' ? pendingApproval.timeoutMs : undefined,
            expiresAt: typeof pendingApproval.expiresAt === 'number' ? pendingApproval.expiresAt : undefined
          }
          : null
      }
    });

    return true;
  }

  function extractPlanFromTasksPayload(tasks: any): any | null {
    if (!tasks || typeof tasks !== 'object') return null;
    if (tasks.currentPlan && typeof tasks.currentPlan === 'object') {
      return tasks.currentPlan;
    }

    const plans = Array.isArray(tasks.plans) ? tasks.plans : [];
    if (plans.length === 0) return null;

    const currentPlanId = typeof tasks.currentPlanId === 'string' ? tasks.currentPlanId : '';
    if (currentPlanId) {
      const active = plans.find((plan: any) => String(plan?.id || '') === currentPlanId);
      if (active) return active;
    }

    return plans[plans.length - 1] || null;
  }

  function getResilienceFallbackMessage(code: string): string {
    switch (code) {
      case 'CTX_BUDGET_UNSAFE':
        return 'Context budget is currently unsafe. Please shorten history or start a new chat.';
      case 'CTX_RECOVERY_EXHAUSTED':
        return 'Automatic context recovery was exhausted. Please start a new chat or reduce history.';
      case 'EMPTY_RESPONSE_DETECTED':
        return 'No assistant response received. Retrying...';
      case 'EMPTY_RESPONSE_RETRY_EXHAUSTED':
        return 'No assistant response was received after retries.';
      case 'RATE_LIMIT_RETRY':
        return 'Provider is busy. Retrying shortly...';
      case 'RATE_LIMIT_RETRY_EXHAUSTED':
        return 'Provider rate-limit retries were exhausted.';
      case 'SEQUENCE_REPAIR_RETRY':
        return 'Repairing tool-call sequence and retrying...';
      case 'SEQUENCE_REPAIR_EXHAUSTED':
        return 'Tool-call sequence could not be repaired automatically.';
      case 'GUARDRAIL_PRIVACY_BLOCK':
        return 'Provider blocked the request due to guardrail/privacy restrictions.';
      case 'MODE_STATE_DESYNC_DETECTED':
        return 'Mode desync detected and auto-synced.';
      case 'MODE_TRANSITION_BLOCKED':
        return 'Mode transition to Code/Act is blocked until a persisted plan exists.';
      case 'MODE_TOOL_BLOCKED':
        return 'Tool call blocked by current mode contract.';
      case 'TOOL_STOPPED_BY_USER':
        return 'Tool execution stopped by user.';
      case 'REQUEST_STOPPED':
        return 'Request stopped.';
      default:
        return 'Resilience status update received.';
    }
  }

  function getResilienceActionHint(action: string): string {
    switch (action) {
      case 'retry':
        return 'Action: Retry.';
      case 'switch_model':
        return 'Action: Switch model.';
      case 'new_chat':
        return 'Action: Start new chat.';
      case 'check_privacy_settings':
        return 'Action: Check privacy settings.';
      case 'switch_to_plan':
        return 'Action: Switch to Architect/Plan mode.';
      case 'create_plan_now':
        return 'Action: Create and persist a plan first.';
      default:
        return '';
    }
  }

  function getSubagentFallbackMessage(code: string): string {
    switch (code) {
      case 'SUBAGENT_START':
        return 'Starting subagent handover...';
      case 'SUBAGENT_PREFLIGHT_BLOCKED':
        return 'Subagent preflight blocked.';
      case 'SUBAGENT_MODE_SWITCHED':
        return 'Switched to code mode for subagent run.';
      case 'SUBAGENT_RUNNING':
        return 'Starting coder worker...';
      case 'SUBAGENT_RETRY_SCHEDULED':
        return 'Subagent retry scheduled.';
      case 'SUBAGENT_RETRY_EXHAUSTED':
        return 'Subagent retries exhausted.';
      case 'SUBAGENT_PREHOOK_BLOCKED':
        return 'Subagent blocked by pre-hook policy.';
      case 'SUBAGENT_PREHOOK_FAILED':
        return 'Subagent pre-hook failed.';
      case 'SUBAGENT_POSTHOOK_FAILED':
        return 'Subagent post-hook failed.';
      case 'SUBAGENT_TERMINAL_FAILED':
        return 'Subagent terminated with failure.';
      case 'SUBAGENT_STOPPED':
        return 'Subagent stopped.';
      case 'SUBAGENT_SUMMARY_READY':
        return 'Subagent summary ready.';
      default:
        return 'Subagent status update received.';
    }
  }

  function getQuestionResolutionHint(source: string): string {
    switch (source) {
      case 'timeout_default':
        return 'Auto-selected default option.';
      case 'stopped':
        return 'Question was stopped.';
      default:
        return 'Answered.';
    }
  }

  function renderQueryRuntimeStatus(data: any): void {
    const code = String(data.code || '');
    const baseMessage = getResilienceFallbackMessage(code);
    const userMessage = typeof data.userMessage === 'string' && data.userMessage.trim().length > 0
      ? data.userMessage
      : baseMessage;
    const actionHint = getResilienceActionHint(String(data.action || 'none'));
    const detailParts = [
      String(data.phase || 'runtime'),
      String(data.decision || 'report'),
      String(data.reason || 'unspecified')
    ];
    const detail = `[${detailParts.join(' | ')}]`;
    const content = [userMessage, actionHint, detail].filter((part) => part && part.trim().length > 0).join(' ');
    chatStore.addMessage({
      id: `sys_query_runtime_${Date.now()}`,
      role: 'system',
      content,
      timestamp: Date.now(),
      isSystemMessage: true,
    });

    if (data.retryable && typeof data.nextDelayMs === 'number' && data.nextDelayMs > 0) {
      extensionStore.setActivityLabel(`${userMessage} (${Math.ceil(data.nextDelayMs / 1000)}s)`);
      extensionStore.setActivityPhase('thinking');
      return;
    }

    if (code === 'REQUEST_STOPPED') {
      extensionStore.clearActivityState();
    }
  }

  function handleQueryRuntimeEvent(data: any): void {
    const event = data?.event;
    if (!event || typeof event.type !== 'string') return;
    queryRuntimeContractActive = true;

    switch (event.type) {
      case 'query_attempt':
        extensionStore.setActivityLabel(`Attempt ${Number(event.attempt || 0)}/${Number(event.maxAttempts || 0)}...`);
        extensionStore.setActivityPhase('thinking');
        return;
      case 'status':
        renderQueryRuntimeStatus(event);
        return;
      case 'compaction_boundary':
        chatStore.addMessage({
          id: `sys_compaction_${Date.now()}`,
          role: 'system',
          content: `Conversation compacted (${String(event.reason || 'budget')}, dropped ${Number(event.droppedCount || 0)} messages).`,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
        return;
      case 'result_success':
        extensionStore.clearActivityState();
        return;
      case 'result_error': {
        const result = event.result || {};
        const terminalMessage = typeof result.message === 'string' && result.message.trim().length > 0
          ? result.message
          : `Query failed with ${String(result.code || 'UNKNOWN_ERROR')}.`;
        chatStore.addMessage({
          id: `sys_query_result_error_${Date.now()}`,
          role: 'system',
          content: terminalMessage,
          timestamp: Date.now(),
          isSystemMessage: true,
        });
        extensionStore.clearActivityState();
        return;
      }
      case 'turn_transition':
        if (String(event.to || '') === 'TERMINAL') {
          extensionStore.clearActivityState();
        }
        return;
      default:
        return;
    }
  }

  function trackUnhandledMessage(data: any): {
    rawType: string;
    correlationId: string;
    count: number;
    firstSeenAt: number;
    lastSeenAt: number;
    shouldSurface: boolean;
  } {
    const now = Date.now();
    const rawType = String(data?.type || 'unknown');
    const correlationId = String(data?.correlationId || `webview:${rawType}`);
    const key = `${rawType}:${correlationId}`;
    const existing = unhandledStats.get(key);
    const next = existing
      ? {
        ...existing,
        count: existing.count + 1,
        lastSeenAt: now
      }
      : {
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSurfacedAt: 0
      };
    const shouldSurface = next.count === 1 || now - next.lastSurfacedAt >= UNHANDLED_SURFACE_WINDOW_MS;
    if (shouldSurface) {
      next.lastSurfacedAt = now;
    }
    unhandledStats.set(key, next);
    return {
      rawType,
      correlationId,
      count: next.count,
      firstSeenAt: next.firstSeenAt,
      lastSeenAt: next.lastSeenAt,
      shouldSurface
    };
  }

  onMount(() => {
    initMessaging({
      // State & lifecycle
      onApiKeyStatus: (data) => settingsStore.setApiKeyStatus(data.hasKey),
      onModelsList: (data) => settingsStore.setModels(data.models),
      onModelChanged: (data) => settingsStore.setSelectedModel(data.model || ''),
      onQueryRuntimeEvent: (data) => {
        handleQueryRuntimeEvent(data);
      },
      onResilienceStatus: (data) => {
        if (queryRuntimeContractActive && ['context', 'empty_response', 'rate_limit', 'sequence', 'request', 'guardrail'].includes(String(data.category || ''))) {
          return;
        }
        const code = String(data.code || '');
        const baseMessage = getResilienceFallbackMessage(code);
        const userMessage = typeof data.userMessage === 'string' && data.userMessage.trim().length > 0
          ? data.userMessage
          : baseMessage;
        const actionHint = getResilienceActionHint(String(data.action || 'none'));
        const detailParts = [
          String(data.phase || 'runtime'),
          String(data.decision || 'report'),
          String(data.reason || 'unspecified')
        ];
        const detail = `[${detailParts.join(' | ')}]`;
        const content = [userMessage, actionHint, detail].filter((part) => part && part.trim().length > 0).join(' ');
        chatStore.addMessage({
          id: `sys_resilience_${Date.now()}`,
          role: 'system',
          content,
          timestamp: Date.now(),
          isSystemMessage: true,
        });

        if (data.retryable && typeof data.nextDelayMs === 'number' && data.nextDelayMs > 0) {
          extensionStore.setActivityLabel(`${userMessage} (${Math.ceil(data.nextDelayMs / 1000)}s)`);
          extensionStore.setActivityPhase('thinking');
          return;
        }

        if (code === 'REQUEST_STOPPED') {
          extensionStore.clearActivityState();
        }
      },
      onSubagentStatus: (data) => {
        const code = String(data.code || '');
        const userMessage = typeof data.userMessage === 'string' && data.userMessage.trim().length > 0
          ? data.userMessage
          : getSubagentFallbackMessage(code);
        const actionHint = getResilienceActionHint(String(data.action || 'none'));
        const detailParts = [
          String(data.phase || 'runtime'),
          String(data.decision || 'report'),
          String(data.reason || 'unspecified')
        ];
        const detail = `[subagent ${String(data.subagentId || 'unknown')}] [${detailParts.join(' | ')}]`;
        const content = [userMessage, actionHint, detail].filter((part) => part && part.trim().length > 0).join(' ');
        chatStore.addMessage({
          id: `sys_subagent_${Date.now()}`,
          role: 'system',
          content,
          timestamp: Date.now(),
          isSystemMessage: true,
        });

        if (data.retryable && typeof data.nextDelayMs === 'number' && data.nextDelayMs > 0) {
          extensionStore.setActivityLabel(`${userMessage} (${Math.ceil(data.nextDelayMs / 1000)}s)`);
          extensionStore.setActivityPhase('thinking');
          return;
        }

        if (code === 'SUBAGENT_STOPPED' || code === 'SUBAGENT_SUMMARY_READY' || code === 'SUBAGENT_TERMINAL_FAILED') {
          extensionStore.clearActivityState();
        }
      },
      onQuestionRequest: (data) => {
        const questionId = String(data.questionId || '');
        if (!questionId) return;
        const messageId = `question_${questionId}`;
        const timestamp = Number(data.timestamp || Date.now());
        const nextCard = {
          questionId,
          header: typeof data.header === 'string' ? data.header : undefined,
          question: String(data.question || ''),
          options: Array.isArray(data.options) ? data.options : [],
          multiple: Boolean(data.multiple),
          timeoutMs: Number(data.timeoutMs || 60000),
          defaultOptionIndex: Number.isInteger(data.defaultOptionIndex) ? Number(data.defaultOptionIndex) : 0,
          status: 'pending' as const,
          selectedOptionIndexes: []
        };

        const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
        if (existing) {
          chatStore.updateMessage(messageId, {
            content: String(data.question || ''),
            questionCard: nextCard,
            timestamp,
            isSystemMessage: false
          });
        } else {
          chatStore.addMessage({
            id: messageId,
            role: 'system',
            content: String(data.question || ''),
            timestamp,
            isSystemMessage: false,
            questionCard: nextCard
          });
        }

        extensionStore.setActivityLabel('Waiting for your answer...');
        extensionStore.setActivityPhase('thinking');
      },
      onQuestionResolved: (data) => {
        const questionId = String(data.questionId || '');
        if (!questionId) return;
        const messageId = `question_${questionId}`;
        const selectedOptionIndexes = Array.isArray(data.selectedOptionIndexes)
          ? data.selectedOptionIndexes.filter((value) => Number.isInteger(value) && value >= 0)
          : [];
        const source = String(data.source || 'user');
        const resolutionSource = source === 'timeout_default' || source === 'stopped' ? source : 'user';
        const timestamp = Number(data.timestamp || Date.now());

        const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
        if (!existing || !existing.questionCard) {
          chatStore.addMessage({
            id: messageId,
            role: 'system',
            content: 'Question resolved.',
            timestamp,
            isSystemMessage: false,
            questionCard: {
              questionId,
              header: undefined,
              question: 'Question resolved.',
              options: [],
              multiple: false,
              timeoutMs: 60000,
              defaultOptionIndex: 0,
              status: 'resolved',
              selectedOptionIndexes,
              resolutionSource
            }
          });
        } else {
          chatStore.updateMessage(messageId, {
            timestamp,
            questionCard: {
              ...existing.questionCard,
              status: 'resolved',
              selectedOptionIndexes,
              resolutionSource
            },
            content: `${existing.questionCard.question} (${getQuestionResolutionHint(source)})`
          });
        }

        extensionStore.clearActivityState();
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
      onInfo: (data) => {
        if (!data?.message) return;
        chatStore.addMessage({
          id: `sys_info_${Date.now()}`,
          role: 'system',
          content: String(data.message),
          timestamp: Date.now(),
          isSystemMessage: true,
        });
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
          diagnostic: {
            code: typeof data.code === 'string' ? data.code : undefined,
            severity: data.severity === 'warning' || data.severity === 'error' ? data.severity : 'info',
            correlationId: typeof data.correlationId === 'string' ? data.correlationId : undefined
          }
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
        if (data?.label == null) {
          const state = get(extensionStore);
          if (!state.isStreaming && !state.isProcessing && state.activeToolCalls.length === 0) {
            extensionStore.clearActivityState();
          }
        }
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
        const approvalId = String(data.approvalId || '');
        const toolName = String(data.toolName || 'tool');
        const timestamp = Number(data.timestamp || Date.now());
        const timeoutMsRaw = Number(data.timeoutMs);
        const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? timeoutMsRaw : undefined;
        const expiresAtRaw = Number(data.expiresAt);
        const expiresAt = Number.isFinite(expiresAtRaw) && expiresAtRaw > timestamp
          ? expiresAtRaw
          : undefined;
        if (approvalId) {
          const messageId = `approval_${approvalId}`;
          const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
          const nextApprovalCard = {
            approvalId,
            toolName,
            params: data.params ?? {},
            status: 'pending' as const,
            reason: null,
            source: 'system' as const,
            createdAt: timestamp,
            timeoutMs,
            expiresAt
          };
          if (existing) {
            chatStore.updateMessage(messageId, {
              content: `Tool approval required for ${toolName}`,
              approvalCard: nextApprovalCard,
              timestamp,
              isSystemMessage: false
            });
          } else {
            chatStore.addMessage({
              id: messageId,
              role: 'system',
              content: `Tool approval required for ${toolName}`,
              timestamp,
              isSystemMessage: false,
              approvalCard: nextApprovalCard
            });
          }
        }

        if (get(extensionStore).approvalOverlayFallbackEnabled) {
          extensionStore.setPendingApproval({
            approvalId,
            toolName,
            params: data.params ?? {},
            timestamp,
            timeoutMs,
            expiresAt
          });
        }
      },
      onToolApprovalResolved: (data) => {
        const approvalId = String(data.approvalId || '');
        if (!approvalId) return;
        const messageId = `approval_${approvalId}`;
        const existing = get(chatStore).messages.find((msg) => msg.id === messageId);
        if (!existing?.approvalCard) {
          chatStore.addMessage({
            id: `sys_approval_resolved_${Date.now()}`,
            role: 'system',
            content: `Approval ${String(data.status || 'resolved')} for ${String(data.toolName || 'tool')}.`,
            timestamp: Number(data.timestamp || Date.now()),
            isSystemMessage: true
          });
          extensionStore.setPendingApproval(null);
          return;
        }
        chatStore.updateMessage(messageId, {
          approvalCard: {
            ...existing.approvalCard,
            status: data.status === 'approved' || data.status === 'rejected'
              ? data.status
              : 'rejected',
            reason: data.reason ?? null,
            source: data.source || 'system',
            resolvedAt: Number(data.timestamp || Date.now())
          },
          content: `Approval ${String(data.status || 'resolved')} for ${existing.approvalCard.toolName}`,
          timestamp: Number(data.timestamp || Date.now())
        });
        extensionStore.setPendingApproval(null);
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
          const nextState = get(extensionStore);
          if (!nextState.isStreaming && !nextState.isProcessing && nextState.activeToolCalls.length === 0) {
            extensionStore.clearActivityState();
          }
          return;
        }
        const candidate = [...state.activeToolCalls].reverse().find((t) => t.toolName === toolName);
        if (candidate) {
          extensionStore.removeActiveToolCall(candidate.toolId);
          const nextState = get(extensionStore);
          if (!nextState.isStreaming && !nextState.isProcessing && nextState.activeToolCalls.length === 0) {
            extensionStore.clearActivityState();
          }
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

      onPlanCardCreated: (data) => {
        const card = toPlanCard(data.plan);
        if (!card) return;
        upsertPlanMessage(card);
      },
      onPlanCardUpdated: (data) => {
        const card = toPlanCard(data.plan);
        if (!card) return;
        upsertPlanMessage(card);
      },
      onPlanUpdated: (data) => {
        const card = toPlanCard(data.plan);
        if (!card) return;
        upsertPlanMessage(card);
      },
      onPlanLoaded: (data) => {
        const card = toPlanCard(data.plan);
        if (!card) return;
        upsertPlanMessage(card);
      },
      onCurrentPlanResponse: (data) => {
        const card = toPlanCard(data.plan);
        if (!card) return;
        upsertPlanMessage(card);
      },
      onPlanStatusUpdate: (data) => {
        const planId = String(data.planId || '');
        if (!planId) return;
        updatePlanCard(planId, (card) => ({
          ...card,
          status: String(data.status || card.status),
          completedSteps: typeof data.completedSteps === 'number' ? Number(data.completedSteps) : card.completedSteps,
          awaitingApproval: String(data.status || '') === 'awaiting_approval'
        }));
      },
      onStepStatusUpdate: (data) => {
        const planId = String(data.planId || '');
        const stepId = String(data.stepId || '');
        if (!planId || !stepId) return;
        updatePlanCard(planId, (card) => {
          const steps = card.steps.map((step) => step.id === stepId
            ? { ...step, status: String(data.status || step.status) }
            : step);
          return {
            ...card,
            steps,
            completedSteps: steps.filter((step) => step.status === 'completed').length
          };
        });
      },
      onPlanApprovalRequested: (data) => {
        const planId = String(data.planId || '');
        if (!planId) return;
        const pendingApproval = {
          approvalRequestId: String(data.approvalRequestId || ''),
          requestedAt: Number(data.timestamp || Date.now()),
          timeoutMs: typeof data.timeoutMs === 'number' && Number.isFinite(data.timeoutMs) ? Number(data.timeoutMs) : undefined,
          expiresAt: typeof data.expiresAt === 'number' && Number.isFinite(data.expiresAt) ? Number(data.expiresAt) : undefined
        };
        const createdFallback = ensurePlanCardForApproval(
          planId,
          String(data.goal || 'Plan approval requested.'),
          Number(data.stepsCount || 0),
          pendingApproval
        );
        if (createdFallback) {
          messaging.send('requestCurrentPlan');
        }
        updatePlanCard(planId, (card) => ({
          ...card,
          status: 'awaiting_approval',
          awaitingApproval: true,
          pendingApproval
        }));
      },
      onPlanApprovalResolved: (data) => {
        const planId = String(data.planId || '');
        if (!planId) return;
        const resolution = String(data.resolution || 'applied');
        const nextStatus = data.status === 'approved' || data.status === 'rejected' || data.status === 'timeout'
          ? data.status
          : 'rejected';
        const createdFallback = ensurePlanCardForApproval(planId, 'Plan approval updated.');
        if (createdFallback) {
          messaging.send('requestCurrentPlan');
        }
        if (resolution !== 'applied') {
          chatStore.addMessage({
            id: `sys_plan_approval_${Date.now()}`,
            role: 'system',
            content: `[Warning:PLAN_APPROVAL_${resolution.toUpperCase()}] ${String(data.reasonCode || data.reason || 'approval_not_applied')}`,
            timestamp: Number(data.timestamp || Date.now()),
            isSystemMessage: true
          });
        }
        updatePlanCard(planId, (card) => ({
          ...card,
          status: resolution === 'applied'
            ? (nextStatus === 'timeout' ? 'awaiting_approval' : nextStatus)
            : card.status,
          awaitingApproval: resolution === 'applied'
            ? nextStatus !== 'approved' && nextStatus !== 'rejected'
            : true,
          pendingApproval: resolution === 'applied'
            ? (nextStatus === 'timeout' ? card.pendingApproval : null)
            : card.pendingApproval
        }));
      },
      onHandoverProgress: (data) => {
        const detail = String(data.detail || 'Handover update.');
        if (data.status === 'started') {
          extensionStore.setActivityLabel('Architect -> Code handover...');
          extensionStore.setActivityPhase('tooling');
        } else if (data.status === 'completed' || data.status === 'aborted') {
          extensionStore.clearActivityState();
        }
        chatStore.addMessage({
          id: `sys_handover_${Date.now()}`,
          role: 'system',
          content: detail,
          timestamp: Number(data.timestamp || Date.now()),
          isSystemMessage: true
        });
      },
      onTokenTrackerUpdate: (_data) => {
        // Consumed in App.svelte header token widget.
      },
      onRestoreSessionState: (_data) => {
        const restoredPlan = extractPlanFromTasksPayload(_data?.tasks);
        if (!restoredPlan) return;
        if (_data?.tasks?.pendingPlanApproval && typeof _data.tasks.pendingPlanApproval === 'object') {
          restoredPlan.pendingApproval = _data.tasks.pendingPlanApproval;
        }
        const card = toPlanCard(restoredPlan);
        if (!card) return;
        upsertPlanMessage(card);
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
      onCheckpointCreated: (data) => {
        const checkpointNumber = Number(data?.checkpointNumber || 0);
        const filesTracked = Number(data?.filesTracked || 0);
        const messageId = `sys_checkpoint_created_${Date.now()}_${checkpointNumber || 0}`;
        const summary = checkpointNumber > 0
          ? `Checkpoint #${checkpointNumber} created (${filesTracked} files tracked).`
          : `Checkpoint created (${filesTracked} files tracked).`;
        chatStore.addMessage({
          id: messageId,
          role: 'system',
          content: summary,
          timestamp: Date.now(),
          isSystemMessage: true
        });
      },

      // Unhandled

      onUnhandled: (data) => {
        const tracked = trackUnhandledMessage(data);
        messaging.send('webviewUnhandledMessage', {
          rawType: tracked.rawType,
          correlationId: tracked.correlationId,
          count: tracked.count,
          firstSeenAt: tracked.firstSeenAt,
          lastSeenAt: tracked.lastSeenAt,
          flowId: typeof data?.flowId === 'string' ? data.flowId : null
        });
        console.warn(
          '[ChatView] Unhandled message:',
          tracked.rawType,
          tracked.correlationId,
          `count=${tracked.count}`
        );
        if (!tracked.shouldSurface) return;
        chatStore.addMessage({
          id: `sys_unhandled_${Date.now()}`,
          role: 'system',
          content: `[Warning:UNKNOWN_WEBVIEW_MESSAGE] ${tracked.rawType} count=${tracked.count} [correlationId=${tracked.correlationId}]`,
          timestamp: Date.now(),
          isSystemMessage: true,
          diagnostic: {
            code: 'UNKNOWN_WEBVIEW_MESSAGE',
            severity: 'warning',
            correlationId: tracked.correlationId
          }
        });
      },
    });

    messaging.send('requestCurrentPlan');
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

{#if $extensionStore.approvalOverlayFallbackEnabled}
  <ToolApprovalModal />
{/if}
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
