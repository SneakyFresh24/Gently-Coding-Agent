import { get } from 'svelte/store';
import { chatStore, isStreaming } from '../stores/chatStore';
import { taskStore } from '../stores/taskStore';
import { settingsStore } from '../stores/settingsStore';
import { terminalStore } from '../stores/terminalStore';
import { validationStore } from '../stores/validationStore';
import { realtimeStore } from '../stores/realtimeStore';
import { extensionSync } from './extensionSync';

export interface BridgeOptions {
    onPromptUpdate?: (prompt: string) => void;
    onTabChange?: (tab: 'thread' | 'task' | 'context') => void;
    onFileRefAdd?: (fileRef: any) => void;
    onApiKeyStatus?: (status: {
        hasKey: boolean;
        agentMode?: any;
        selectedModel?: string;
        selectedMode?: string;
        error?: string
    }) => void;
    onModelsList?: (models: any[]) => void;
    onContextUpdate?: (files: any[], stats: any) => void;
    onRestoreSession?: (data: { tasks?: any; context?: any }) => void;
}

let isInitialized = false;
let listeners: BridgeOptions[] = [];

const handleMessage = (event: MessageEvent) => {
    const msg = event.data;

    switch (msg.type) {
                case "generatingStart":
                    realtimeStore.setGenerating(true);
                    break;

                case "generatingEnd":
                    realtimeStore.setGenerating(false);
                    break;

                case "assistantMessageChunk":
                    if (!get(isStreaming)) {
                        const streamId = chatStore.startAssistantMessage();
                        realtimeStore.setGenerating(true, streamId);
                    }
                    chatStore.appendChunk(msg.chunk);
                    break;

                case "assistantMessageEnd":
                    chatStore.endAssistantMessage(msg.messageId);
                    realtimeStore.setGenerating(false);
                    break;

                case "assistantMessageFull":
                    if (msg.content) {
                        chatStore.addFullAssistantMessage(msg.content, msg.messageId);
                        realtimeStore.setGenerating(false);
                    }
                    break;

                case "taskStart":
                    realtimeStore.setTaskRunning(true);
                    break;

                case "taskComplete":
                    realtimeStore.setTaskRunning(false);
                    break;

                case "iterativePlanCompleted":
                    realtimeStore.setActivity(null);
                    realtimeStore.setGenerating(false);
                    realtimeStore.setTaskRunning(false);
                    if (msg.plan) {
                        taskStore.updatePlan(msg.plan);
                    }
                    break;

                case "planCreated":
                    if (msg.plan) {
                        taskStore.addPlan(msg.plan);
                        realtimeStore.setTaskRunning(true, msg.plan.id);
                        listeners.forEach(l => l.onTabChange?.('task'));
                    }
                    break;

                case "planStatusUpdate":
                    taskStore.updatePlanStatus(msg.planId, msg.status);
                    if (msg.status === "completed" || msg.status === "failed") {
                        realtimeStore.setActivity(null);
                        realtimeStore.setGenerating(false);
                        realtimeStore.setTaskRunning(false);
                    }
                    break;

                case "stepStatusUpdate":
                    taskStore.updateStepStatus(
                        msg.planId,
                        msg.stepId,
                        msg.status,
                        msg.result,
                        msg.error,
                    );
                    if (msg.status === "in-progress") {
                        realtimeStore.setActiveToolCount(get(realtimeStore).activeToolCount + 1);
                    } else if (msg.status === "completed" || msg.status === "failed") {
                        realtimeStore.setActiveToolCount(Math.max(0, get(realtimeStore).activeToolCount - 1));
                    }
                    break;

                case "currentPlanResponse":
                case "planLoaded":
                    taskStore.hydrateTasks(
                        msg.plans || (msg.plan ? [msg.plan] : []),
                        msg.planId || msg.plan?.id,
                    );
                    taskStore.setLoading(false);
                    taskStore.setHasError(false);
                    break;

                case "planLoadError":
                case "sessionLoadError":
                    taskStore.setLoading(false);
                    taskStore.setHasError(true);
                    break;

                case "planUpdated":
                    if (msg.plan) {
                        taskStore.updatePlan(msg.plan);
                    }
                    break;

                case "checkpointCreated":
                    chatStore.addCheckpoint(msg.messageId, {
                        id: msg.checkpointId,
                        checkpointNumber: msg.checkpointNumber,
                        filesTracked: msg.filesTracked,
                    });
                    break;

                case "error":
                case "usageLimitError":
                    chatStore.setError(msg.message);
                    break;

                case "clearMessages":
                    chatStore.clearMessages();
                    break;

                case "systemMessage":
                    chatStore.addSystemMessage(msg.content || msg.message);
                    break;

                case "loadMessages":
                    if (msg.messages && Array.isArray(msg.messages)) {
                        chatStore.clearMessages();
                        for (const m of msg.messages) {
                            if (m.role === "user") {
                                chatStore.addUserMessage(m.content, m.fileReferences);
                            } else if (m.role === "assistant") {
                                chatStore.addFullAssistantMessage(m.content, m.id);
                            } else if (m.role === "system") {
                                chatStore.restoreSystemMessage(m.id, m.content, m.timestamp);
                            } else if (m.role === "command-approval" && m.commandApproval) {
                                chatStore.restoreCommandApprovalMessage(m.id, m.commandApproval, m.timestamp);
                            } else if (m.role === "tool-execution" && m.toolExecution) {
                                chatStore.restoreToolExecutionMessage(m.id, m.toolExecution, m.timestamp);
                            }
                        }
                    }
                    break;

                case "setPromptFromGuardian":
                    if (msg.prompt) {
                        listeners.forEach(l => l.onPromptUpdate?.(msg.prompt));
                        listeners.forEach(l => l.onTabChange?.('thread'));
                    }
                    break;

                case "addFileReference":
                    if (msg.fileReference) {
                        listeners.forEach(l => l.onFileRefAdd?.(msg.fileReference));
                        listeners.forEach(l => l.onTabChange?.('thread'));
                    }
                    break;

                case "commandApprovalRequest":
                    if (msg.request) chatStore.addCommandApprovalMessage(msg.request);
                    break;

                case "terminalOutputChunk":
                    if (msg.commandId && msg.chunk) {
                        const chunk = msg.chunk;
                        if (chunk.type === "status") {
                            terminalStore.startExecution(msg.commandId, chunk.message || "");
                            realtimeStore.setTerminalActive(true);
                        } else if (["stdout", "stderr", "error"].includes(chunk.type)) {
                            terminalStore.addOutput(
                                msg.commandId,
                                chunk.type,
                                chunk.data || chunk.message || "",
                            );
                        } else if (chunk.type === "complete") {
                            terminalStore.completeExecution(
                                msg.commandId,
                                chunk.exitCode || 0,
                                chunk.duration || 0,
                            );
                            realtimeStore.setTerminalActive(false);
                        }
                    }
                    break;

                case "terminalModeChanged":
                    if (msg.mode) terminalStore.setMode(msg.mode);
                    break;

                case "commandKilled":
                    if (msg.commandId) terminalStore.removeExecution(msg.commandId);
                    break;

                case "apiKeyStatus":
                    listeners.forEach(l => l.onApiKeyStatus?.({
                        hasKey: msg.hasKey,
                        agentMode: msg.agentMode,
                        selectedModel: msg.selectedModel,
                        selectedMode: msg.selectedMode || msg.currentMode?.id,
                        error: msg.error
                    }));
                    break;

                case "modelsList":
                    listeners.forEach(l => l.onModelsList?.(msg.models));
                    break;

                case "contextUpdate":
                    listeners.forEach(l => l.onContextUpdate?.(msg.files, msg.stats));
                    break;

                case "restoreSessionState":
                    listeners.forEach(l => l.onRestoreSession?.({ tasks: msg.tasks, context: msg.context }));
                    break;

                case "handover_to_coder":
                    settingsStore.setSelectedMode("code");
                    setTimeout(() => {
                        extensionSync.send("sendMessage", {
                            message: msg.message + "\n\n(Execute Plan ID: " + msg.planId + ")",
                            fileReferences: []
                        });
                    }, 800);
                    break;

                case "promptEnhancing":
                    realtimeStore.setEnhancing(msg.isEnhancing);
                    break;

                case "promptEnhanced":
                    listeners.forEach(l => l.onPromptUpdate?.(msg.enhancedPrompt));
                    realtimeStore.setEnhanceSuccess(true);
                    break;

                case "promptEnhanceError":
                    chatStore.setError(msg.error || "Failed to enhance prompt");
                    realtimeStore.setEnhancing(false);
                    break;

                case "validationStart":
                    validationStore.startValidation(msg.file);
                    realtimeStore.setValidationStatus("validating");
                    break;

                case "validationProgress":
                    validationStore.updateProgress(msg.attempt, msg.errorCount);
                    break;

                case "validationComplete":
                    validationStore.setSuccess(msg.duration);
                    realtimeStore.setValidationStatus("success");
                    break;

                case "validationFailed":
                    validationStore.setError(msg.errors, msg.duration);
                    realtimeStore.setValidationStatus("error", (msg.errors as any[])?.length ?? 0);
                    break;

                case "activityUpdate":
                    console.log('[Webview] activityUpdate received:', msg.label);
                    realtimeStore.setActivity(msg.label || null);
                    break;
            }
        };

export const extensionEvents = {
    init(options: BridgeOptions = {}) {
        listeners.push(options);

        if (!isInitialized) {
            isInitialized = true;
            window.addEventListener("message", handleMessage);

            // Initial requests
            extensionSync.send("requestSessionMetadata", {});
            extensionSync.send("requestCurrentPlan", {});
            settingsStore.hydrate();
        }

        return () => {
            listeners = listeners.filter(l => l !== options);
        };
    }
};
