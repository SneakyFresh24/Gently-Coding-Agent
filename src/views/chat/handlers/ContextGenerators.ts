import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { FileReferenceManager, FileReference } from '../../../agent/fileReferenceManager';
import { RESPONSE_FORMATTING_PROMPT } from '../../../agent/prompts/responseFormatting';
import { PromptBuilder } from '../../../agent/prompts/PromptBuilder';
import { ModeService } from '../../../modes/ModeService';
import { ChatViewContext, Message } from '../types/ChatTypes';
import { OpenRouterService } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';
import type { PromptConfig } from '../../../agent/prompts/types';

const log = new LogService('ContextGenerators');
export const MAX_HISTORY_LENGTH = 50;
export const NUM_MESSAGES_TO_PRUNE = 10;
const LEGACY_MAX_HISTORY_LENGTH = 20;
const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 500;
const DEFAULT_PROTECTED_TURNS = 2;
const TRUNCATION_PREFIX = '[TRUNCATED';
const MARKER_ARROW = '→';
const TOOL_OUTPUT_REASON = 'tool_output';
const HISTORY_LIMIT_REASON = 'history_limit';

type PruningStrategy = 'hybrid' | 'legacy';

interface PruningConfig {
    strategy: PruningStrategy;
    maxHistoryLength: number;
    maxToolOutputChars: number;
    protectedTurns: number;
    legacyPruneCooldownMsgs: number;
}

/**
 * Handles parsing of @references in user messages.
 */
export class ReferenceParser {
    constructor(private readonly fileReferenceManager: FileReferenceManager) { }

    async processMessageWithReferences(
        userMessage: string,
        silent: boolean,
        fileReferences?: FileReference[]
    ): Promise<{ enhancedMessage: string; loadedReferences: FileReference[] }> {
        let parsedMessage = userMessage;
        let loadedReferences: FileReference[] = [];

        if (fileReferences && fileReferences.length > 0) {
            loadedReferences = await this.fileReferenceManager.loadReferences(fileReferences);
        } else if (!silent && userMessage) {
            const parsed = this.fileReferenceManager.parseReferences(userMessage);
            parsedMessage = parsed.cleanedMessage;
            if (parsed.references.length > 0) {
                loadedReferences = await this.fileReferenceManager.loadReferences(parsed.references);
            }
        }

        let enhancedMessage = parsedMessage;
        if (loadedReferences.length > 0) {
            const fileContext = this.fileReferenceManager.generateContextPrompt(loadedReferences);
            enhancedMessage = `${fileContext}\n\n---\n\n**USER QUESTION:**\n${parsedMessage}`;
        }

        return { enhancedMessage, loadedReferences };
    }
}

/**
 * Manages construction of system prompts and context integration.
 */
export class PromptManager {
    private readonly promptBuilder = new PromptBuilder();

    constructor(
        private readonly agentManager: AgentManager,
        private readonly modeService: ModeService
    ) { }

    async prepareSystemPrompt(context: ChatViewContext, retryCount: number = 0): Promise<string> {
        const start = Date.now();
        const workspaceName = vscode.workspace.name || 'No workspace open';
        const memoryBankStart = Date.now();
        const memoryBankContext = await this.agentManager.getMemoryBankContext();
        log.info(JSON.stringify({
            'perf.phase': 'getMemoryBankContext',
            duration_ms: Date.now() - memoryBankStart,
            flow_id: context.currentFlowId || null,
            model: context.selectedModel || null,
            workspace: workspaceName
        }));
        const memoriesStart = Date.now();
        const memoriesPrompt = await this.agentManager.getMemoryManager().getMemoriesForPrompt('');
        log.info(JSON.stringify({
            'perf.phase': 'getMemoriesForPrompt',
            duration_ms: Date.now() - memoriesStart,
            flow_id: context.currentFlowId || null,
            model: context.selectedModel || null,
            workspace: workspaceName
        }));
        const mode = this.modeService.getCurrentMode();
        const fallbackPrompt = this.buildLegacySystemPrompt(context, retryCount, memoryBankContext, memoriesPrompt);

        if (!this.modeService.isPromptPipelineEnabled()) {
            return fallbackPrompt;
        }

        try {
            const config = vscode.workspace.getConfiguration('gently');
            const familyOverridesEnabled = config.get<boolean>('promptPipeline.familyOverrides', true);
            const modeTools = mode ? mode.getToolsForMode(this.agentManager) : this.agentManager.getFormattedTools();
            const modeToolNames = (modeTools || [])
                .map((tool: any) => tool?.function?.name || tool?.name)
                .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0);
            const toolSpecs = this.agentManager.getPromptToolSpecs(modeToolNames);

            const basePromptConfig = this.modeService.getPromptConfig();
            const promptConfig: PromptConfig | undefined = context.promptVariantOverride
                ? (
                    basePromptConfig
                        ? { ...basePromptConfig, variant: context.promptVariantOverride }
                        : basePromptConfig
                )
                : basePromptConfig;

            const result = this.promptBuilder.build({
                mode: mode?.id || context.selectedMode || 'architect',
                model: context.selectedModel,
                familyOverridesEnabled,
                workspaceName,
                retryCount,
                memoryBankContext,
                memoriesPrompt,
                conversationSummary: context.conversationSummary,
                tools: toolSpecs,
                promptConfig
            }, {
                strictTemplates: false,
                legacyFallbackPrompt: fallbackPrompt
            });

            log.info(`PromptBuilder active: id=${result.metadata.promptId} version=${result.metadata.version} variant=${result.metadata.variant} hash=${result.metadata.hash} fallback=${result.metadata.usedFallback}`);
            log.info(JSON.stringify({
                'perf.phase': 'prepareSystemPrompt',
                duration_ms: Date.now() - start,
                flow_id: context.currentFlowId || null,
                model: context.selectedModel || null,
                workspace: workspaceName,
                variant: result.metadata.variant
            }));
            return result.prompt;
        } catch (error) {
            log.warn(`PromptBuilder failed, using legacy prompt: ${(error as Error).message}`);
            log.info(JSON.stringify({
                'perf.phase': 'prepareSystemPrompt',
                duration_ms: Date.now() - start,
                flow_id: context.currentFlowId || null,
                model: context.selectedModel || null,
                workspace: workspaceName,
                variant: context.promptVariantOverride || this.modeService.getPromptConfig()?.variant || 'default',
                fallback: true
            }));
            return fallbackPrompt;
        }
    }

    private buildLegacySystemPrompt(
        context: ChatViewContext,
        retryCount: number,
        memoryBankContext: string,
        memoriesPrompt: string
    ): string {
        let systemPrompt = this.modeService.getSystemPrompt() || `You are Gently, an AI coding agent integrated into VS Code.
You help delevopers write, understand, and debug code.
Current workspace: ${vscode.workspace.name || 'No workspace open'}`;

        systemPrompt += `\n\n${RESPONSE_FORMATTING_PROMPT}`;

        if (memoryBankContext) {
            systemPrompt += `\n\n${memoryBankContext}`;
        }

        if (memoriesPrompt) {
            systemPrompt += memoriesPrompt;
        }

        const modelLower = (context.selectedModel || '').toLowerCase();
        if (modelLower.includes('minimax') || modelLower.includes('m2.5') || modelLower.includes('glm')) {
            systemPrompt += `\n\nWICHTIG: Nach Tool-Ausführung IMMER eine klare Antwort geben – niemals leer lassen.`;
        }

        if (context.conversationSummary) {
            systemPrompt += `\n\n--- PREVIOUS CONVERSATION SUMMARY ---\n${context.conversationSummary}\n-----------------------------------\n`;
        }

        if (retryCount > 0) {
            if (retryCount === 1) {
                systemPrompt += '\n\nRETRY LEVEL 1: The previous tool call failed. Check your parameters and try again.';
            } else if (retryCount === 2) {
                systemPrompt += '\n\nRETRY LEVEL 2: This is your 2nd failed attempt. You MUST use a different approach.';
            } else {
                systemPrompt += '\n\nRETRY LEVEL 3+: CRITICAL. STOP retrying the same approach. Use alternatives only, or report the issue to the user.';
            }
        }

        systemPrompt += `\n\nTOOL ARGUMENT ORDER REMINDER:\n` +
            `Edit sequence is mandatory:\n` +
            `1. ALWAYS call read_file before apply_block_edit or safe_edit_file for the same file\n` +
            `2. NEVER edit based on assumed file contents\n\n` +
            `When using apply_block_edit / write_file / safe_edit_file:\n` +
            `1. ALWAYS put path/file_path BEFORE content/new_content\n` +
            `2. Keep content under 50KB per call\n` +
            `3. Split larger writes into multiple calls\n` +
            `Example: {"path":"src/file.ts","content":"..."}`;

        return systemPrompt;
    }

    private getAgentModePrompt(): string {
        return `
\n🤖 AGENT MODE ACTIVE - You are an autonomous coding agent with access to powerful tools.

CRITICAL INSTRUCTIONS:
1. ALWAYS create a plan BEFORE using tools
2. Explain what you're going to do in 1-3 sentences maximum.
3. Then use the tools to accomplish the task
4. After tool execution, explain what you did briefly.

When using create_plan, use valid JSON.
`;
    }
}

/**
 * Handles summarization and pruning of conversation history.
 */
export class ConversationPruner {
    private lastLegacySummaryHistoryLength = 0;
    constructor(
        private openRouterService: OpenRouterService,
        private agentManager: AgentManager
    ) { }

    shouldPrune(historyLength: number): boolean {
        const config = this.getPruningConfig();
        const threshold = config.strategy === 'legacy' ? LEGACY_MAX_HISTORY_LENGTH : config.maxHistoryLength;
        return historyLength > threshold;
    }

    async pruneConversationHistory(context: ChatViewContext): Promise<void> {
        const config = this.getPruningConfig();
        const threshold = config.strategy === 'legacy' ? LEGACY_MAX_HISTORY_LENGTH : config.maxHistoryLength;
        if (context.conversationHistory.length <= threshold) return;
        await this.agentManager.getHookManager().executePreCompact({
            strategy: config.strategy,
            historyLength: context.conversationHistory.length,
            threshold
        });
        await this.agentManager.getHookManager().executeNotification({
            channel: 'compaction',
            severity: 'info',
            message: `Compaction started (${config.strategy})`,
            metadata: { historyLength: context.conversationHistory.length, threshold }
        });

        if (config.strategy === 'legacy') {
            await this.pruneConversationHistoryLegacy(context);
            return;
        }

        const beforeMessages = context.conversationHistory;
        const beforeCount = beforeMessages.length;
        const beforeTokens = this.estimateTokens(beforeMessages);
        const phase1Result = this.pruneToolOutputs(beforeMessages, config);
        const phase2Result = this.truncateHistoryByRules(phase1Result.messages, config.maxHistoryLength);
        const finalMessages = phase2Result.messages;
        const afterTokens = this.estimateTokens(finalMessages);
        const savedTokens = Math.max(0, beforeTokens - afterTokens);

        context.conversationHistory = finalMessages;

        log.info(
            `Hybrid Pruning: ${beforeCount}->${finalMessages.length} msgs, saved ~${savedTokens} tokens, ` +
            `phase1=${phase1Result.toolOutputsPruned}, phase2=${phase2Result.messagesDropped}`
        );

        if (finalMessages.length > config.maxHistoryLength) {
            log.warn(
                `Hybrid pruning remains above maxHistoryLength (${finalMessages.length}/${config.maxHistoryLength}) due to protected/pinned/system messages.`
            );
        }
        await this.agentManager.getHookManager().executeNotification({
            channel: 'compaction',
            severity: 'info',
            message: 'Compaction completed',
            metadata: { beforeCount, afterCount: finalMessages.length, strategy: config.strategy }
        });
    }

    private async pruneConversationHistoryLegacy(context: ChatViewContext): Promise<void> {
        if (context.conversationHistory.length <= LEGACY_MAX_HISTORY_LENGTH) return;
        const config = this.getPruningConfig();

        log.info(`Pruning conversation history from ${context.conversationHistory.length} messages...`);
        let pruneIndex = NUM_MESSAGES_TO_PRUNE;
        while (pruneIndex < context.conversationHistory.length) {
            const msg = context.conversationHistory[pruneIndex];
            if (msg.role === 'user' || (msg.role === 'assistant' && (!msg.tool_calls || msg.tool_calls.length === 0))) {
                break;
            }
            pruneIndex++;
        }

        const messagesToSummarize = context.conversationHistory.slice(0, pruneIndex);
        const messagesSinceLastSummary = Math.max(0, context.conversationHistory.length - this.lastLegacySummaryHistoryLength);
        if (this.lastLegacySummaryHistoryLength > 0 && messagesSinceLastSummary < config.legacyPruneCooldownMsgs) {
            log.info(`Legacy pruning cooldown active (${messagesSinceLastSummary}/${config.legacyPruneCooldownMsgs}). Applying deterministic fallback.`);
            context.conversationHistory = context.conversationHistory.slice(pruneIndex);
            return;
        }
        if (!context.selectedModel) {
            log.warn('Skipping conversation summary because no model is selected.');
            return;
        }

        try {
            log.info(`Getting summary of oldest ${pruneIndex} messages...`);
            const summaryPrompt = `Summarize the following conversation segment into a concise list of hard facts. 
What was achieved so far? What is the current plan being followed?
We already have context of the older facts: ${context.conversationSummary || 'None'}. 
Combine them and give an updated concise bullet-point summary of the facts and the current objective.

Conversation Segment:
${messagesToSummarize.map(m => `[${m.role}]: ${m.content}`).join('\n')}
`;

            const summaryPromise = (async () => {
                let summary = '';
                for await (const chunk of this.openRouterService.streamChatMessage({
                    messages: [{ role: 'user', content: summaryPrompt }],
                    model: context.selectedModel || undefined,
                    stream: true,
                    temperature: 0.1,
                    max_tokens: 1000
                })) {
                    if (typeof chunk === 'string') {
                        summary += chunk;
                    }
                }
                return summary;
            })();

            const timeoutMs = 25000;
            const summary = await Promise.race<string>([
                summaryPromise,
                new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`legacy_summary_timeout_${timeoutMs}ms`)), timeoutMs))
            ]);

            if (summary) {
                context.conversationSummary = summary;
                try {
                    await this.agentManager.addMemory(`Conversation segment summary: ${summary}`, 'automatic', 'workflow');
                } catch (memError) {
                    log.error('Failed to persist summary to memory:', memError);
                }
                context.conversationHistory = context.conversationHistory.slice(pruneIndex);
                this.lastLegacySummaryHistoryLength = context.conversationHistory.length;
                log.info(`History pruned. ${context.conversationHistory.length} messages remaining.`);
            }
        } catch (error) {
            log.error('Failed to summarize and prune conversation history:', error);
            log.info('Legacy pruning fallback activated after summary failure.');
            context.conversationHistory = context.conversationHistory.slice(pruneIndex);
        }
    }

    private getPruningConfig(): PruningConfig {
        const config = vscode.workspace.getConfiguration('gently');
        const strategyRaw = String(config.get<string>('pruning.strategy', 'hybrid')).toLowerCase();
        const strategy: PruningStrategy = strategyRaw === 'legacy' ? 'legacy' : 'hybrid';
        const maxHistoryLength = this.sanitizePositiveInt(config.get<number>('pruning.maxHistoryLength', MAX_HISTORY_LENGTH), MAX_HISTORY_LENGTH);
        const maxToolOutputChars = this.sanitizePositiveInt(config.get<number>('pruning.maxToolOutputChars', DEFAULT_MAX_TOOL_OUTPUT_CHARS), DEFAULT_MAX_TOOL_OUTPUT_CHARS);
        const protectedTurns = this.sanitizePositiveInt(config.get<number>('pruning.protectedTurns', DEFAULT_PROTECTED_TURNS), DEFAULT_PROTECTED_TURNS);
        const legacyPruneCooldownMsgs = this.sanitizePositiveInt(config.get<number>('performance.legacyPruneCooldownMsgs', 20), 20);
        return {
            strategy,
            maxHistoryLength,
            maxToolOutputChars,
            protectedTurns,
            legacyPruneCooldownMsgs
        };
    }

    private sanitizePositiveInt(value: number | undefined, fallback: number): number {
        if (!Number.isFinite(value)) return fallback;
        const normalized = Math.floor(Number(value));
        return normalized > 0 ? normalized : fallback;
    }

    private pruneToolOutputs(messages: Message[], config: PruningConfig): { messages: Message[]; toolOutputsPruned: number } {
        const protectedFrom = this.getProtectedHistoryStart(messages, config.protectedTurns);
        let toolOutputsPruned = 0;

        const updated = messages.map((message, index) => {
            if (index >= protectedFrom) return message;
            let changed = false;
            let nextMessage: Message = message;

            if (message.role === 'tool' && typeof message.content === 'string') {
                const truncatedToolContent = this.truncateToolOutputWithMarker(message.content, config.maxToolOutputChars);
                if (truncatedToolContent !== message.content) {
                    nextMessage = { ...nextMessage, content: truncatedToolContent };
                    changed = true;
                    toolOutputsPruned += 1;
                }
            }

            // Defensive fallback: some providers may attach result fields directly to assistant tool calls.
            if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
                const updatedToolCalls = message.tool_calls.map((toolCall: any) => {
                    if (!toolCall || typeof toolCall !== 'object') return toolCall;
                    const resultValue = toolCall.result;
                    if (typeof resultValue !== 'string') return toolCall;
                    const truncatedResult = this.truncateToolOutputWithMarker(resultValue, config.maxToolOutputChars);
                    if (truncatedResult === resultValue) return toolCall;
                    changed = true;
                    toolOutputsPruned += 1;
                    return { ...toolCall, result: truncatedResult };
                });

                if (changed) {
                    nextMessage = { ...nextMessage, tool_calls: updatedToolCalls };
                }
            }

            return changed ? nextMessage : message;
        });

        return { messages: updated, toolOutputsPruned };
    }

    private truncateHistoryByRules(messages: Message[], maxHistoryLength: number): { messages: Message[]; messagesDropped: number } {
        const withoutOldMarkers = messages.filter((message) => !this.isHistoryLimitMarker(message));
        if (withoutOldMarkers.length <= maxHistoryLength) {
            return { messages: withoutOldMarkers, messagesDropped: 0 };
        }

        const selectedIndexes = new Set<number>();
        this.addMandatorySystemAndPinned(withoutOldMarkers, selectedIndexes);
        this.addFirstPair(withoutOldMarkers, selectedIndexes);

        const targetSize = Math.max(1, maxHistoryLength - 1);
        for (let i = withoutOldMarkers.length - 1; i >= 0 && selectedIndexes.size < targetSize; i--) {
            selectedIndexes.add(i);
        }

        const truncated = withoutOldMarkers.filter((_, index) => selectedIndexes.has(index));
        const messagesDropped = Math.max(0, withoutOldMarkers.length - truncated.length);
        if (messagesDropped <= 0) {
            return { messages: truncated, messagesDropped: 0 };
        }

        const marker = this.buildMarker(`${withoutOldMarkers.length}msgs`, HISTORY_LIMIT_REASON);
        const markerMessage: Message = {
            id: `prune-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            role: 'system',
            content: marker,
            timestamp: Date.now(),
            isSystemMessage: true
        };
        const insertAt = this.findSystemInsertIndex(truncated);
        const withMarker = [...truncated.slice(0, insertAt), markerMessage, ...truncated.slice(insertAt)];

        return { messages: withMarker, messagesDropped };
    }

    private addMandatorySystemAndPinned(messages: Message[], selectedIndexes: Set<number>): void {
        messages.forEach((message, index) => {
            if (message.role === 'system' || message.pinned) {
                selectedIndexes.add(index);
            }
        });
    }

    private addFirstPair(messages: Message[], selectedIndexes: Set<number>): void {
        const firstUserIndex = messages.findIndex((message) => message.role === 'user');
        if (firstUserIndex < 0) return;
        selectedIndexes.add(firstUserIndex);
        const firstAssistantAfterUser = messages.findIndex((message, index) => index > firstUserIndex && message.role === 'assistant');
        if (firstAssistantAfterUser >= 0) {
            selectedIndexes.add(firstAssistantAfterUser);
        }
    }

    private getProtectedHistoryStart(messages: Message[], protectedTurns: number): number {
        let userTurnsSeen = 0;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                userTurnsSeen += 1;
                if (userTurnsSeen >= protectedTurns) {
                    return i;
                }
            }
        }
        return 0;
    }

    private truncateToolOutputWithMarker(content: string, maxLen: number): string {
        if (!content || content.length <= maxLen) return content;
        const marker = this.buildMarker(String(content.length), TOOL_OUTPUT_REASON);
        if (maxLen <= marker.length) {
            return marker.slice(0, maxLen);
        }
        const contentBudget = maxLen - marker.length - 1;
        const prioritized = this.truncateWithPriority(content, contentBudget);
        return `${prioritized}\n${marker}`;
    }

    private truncateWithPriority(content: string, maxLen: number): string {
        if (!content || maxLen <= 0) return '';
        if (content.length <= maxLen) return content;

        const lines = content.split('\n');
        const head = lines.slice(0, 3);
        const errorLines = lines.filter((line) => /(error|failed|exception)/i.test(line)).slice(0, 5);
        const tail = lines.slice(-5);
        const combined = [...head, ...errorLines, ...tail];
        const deduped: string[] = [];
        const seen = new Set<string>();
        for (const line of combined) {
            if (seen.has(line)) continue;
            seen.add(line);
            deduped.push(line);
        }

        return deduped.join('\n').slice(0, maxLen);
    }

    private buildMarker(from: string, reason: string): string {
        return `${TRUNCATION_PREFIX} ${from}${MARKER_ARROW}${reason}]`;
    }

    private isHistoryLimitMarker(message: Message): boolean {
        return message.role === 'system'
            && typeof message.content === 'string'
            && message.content.startsWith(TRUNCATION_PREFIX)
            && message.content.includes(`${MARKER_ARROW}${HISTORY_LIMIT_REASON}]`);
    }

    private findSystemInsertIndex(messages: Message[]): number {
        let index = 0;
        while (index < messages.length && messages[index].role === 'system') {
            index++;
        }
        return index;
    }

    private estimateTokens(messages: Message[]): number {
        const totalChars = messages.reduce((sum, message) => {
            const contentLen = typeof message.content === 'string' ? message.content.length : 0;
            const toolCallLen = Array.isArray(message.tool_calls) ? JSON.stringify(message.tool_calls).length : 0;
            return sum + contentLen + toolCallLen;
        }, 0);
        return Math.ceil(totalChars / 4);
    }
}
