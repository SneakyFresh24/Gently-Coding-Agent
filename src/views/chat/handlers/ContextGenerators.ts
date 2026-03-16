import * as vscode from 'vscode';
import { AgentManager } from '../../../agent/agentManager/AgentManager';
import { FileReferenceManager, FileReference } from '../../../agent/fileReferenceManager';
import { RESPONSE_FORMATTING_PROMPT } from '../../../agent/prompts/responseFormatting';
import { ModeService } from '../../../modes/ModeService';
import { ChatViewContext } from '../types/ChatTypes';
import { OpenRouterService } from '../../../services/OpenRouterService';
import { LogService } from '../../../services/LogService';

const log = new LogService('ContextGenerators');

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
    constructor(
        private readonly agentManager: AgentManager,
        private readonly modeService: ModeService
    ) { }

    async prepareSystemPrompt(context: ChatViewContext, retryCount: number = 0): Promise<string> {
        // Use the system prompt defined in the current mode
        let systemPrompt = this.modeService.getSystemPrompt() || `You are Gently, an AI coding agent integrated into VS Code.
You help delevopers write, understand, and debug code.
Current workspace: ${vscode.workspace.name || 'No workspace open'}`;

        systemPrompt += `\n\n${RESPONSE_FORMATTING_PROMPT}`;

        const memoryBankContext = await this.agentManager.getMemoryBankContext();
        if (memoryBankContext) {
            systemPrompt += `\n\n${memoryBankContext}`;
        }

        const memoriesPrompt = await this.agentManager.getMemoryManager().getMemoriesForPrompt('');
        if (memoriesPrompt) {
            systemPrompt += memoriesPrompt;
        }

        systemPrompt += `\n\n--- GUARDIAN MEMORY ---\n` +
            `Wichtige Architektur-Entscheidungen und Regeln werden automatisch von Guardian in decisions.md und rules.md gespeichert.\n` +
            `Berücksichtige diese Dokumente immer bei Architektur-Änderungen oder neuen Features.\n`;

        const modelLower = context.selectedModel.toLowerCase();
        if (modelLower.includes('minimax') || modelLower.includes('m2.5') || modelLower.includes('glm')) {
            systemPrompt += `\n\nWICHTIG: Nach Tool-Ausführung IMMER eine klare Antwort geben – niemals leer lassen.`;
        }

        if (context.conversationSummary) {
            systemPrompt += `\n\n--- PREVIOUS CONVERSATION SUMMARY ---\n${context.conversationSummary}\n-----------------------------------\n`;
        }

        if (retryCount > 0) {
            systemPrompt += `\n\n🔄 RETRY ATTEMPT ${retryCount}/3 - CRITICAL:\n` +
                'Ensure that all tool_calls have VALID JSON arguments. Use double quotes, escape special characters, and close all brackets.';
        }

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
    constructor(
        private openRouterService: OpenRouterService,
        private agentManager: AgentManager
    ) { }

    async pruneConversationHistory(context: ChatViewContext): Promise<void> {
        const MAX_HISTORY_LENGTH = 20;
        const NUM_MESSAGES_TO_PRUNE = 10;

        if (context.conversationHistory.length <= MAX_HISTORY_LENGTH) return;

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

        try {
            log.info(`Getting summary of oldest ${pruneIndex} messages...`);
            const summaryPrompt = `Summarize the following conversation segment into a concise list of hard facts. 
What was achieved so far? What is the current plan being followed?
We already have context of the older facts: ${context.conversationSummary || 'None'}. 
Combine them and give an updated concise bullet-point summary of the facts and the current objective.

Conversation Segment:
${messagesToSummarize.map(m => `[${m.role}]: ${m.content}`).join('\n')}
`;

            let summary = '';
            for await (const chunk of this.openRouterService.streamChatMessage({
                messages: [{ role: 'user', content: summaryPrompt }],
                model: typeof context.selectedModel === 'string' ? context.selectedModel : 'deepseek-chat',
                stream: true,
                temperature: 0.1,
                max_tokens: 1000
            })) {
                if (typeof chunk === 'string') {
                    summary += chunk;
                }
            }

            if (summary) {
                context.conversationSummary = summary;
                try {
                    await this.agentManager.addMemory(`Conversation segment summary: ${summary}`, 'automatic', 'workflow');
                } catch (memError) {
                    log.error('Failed to persist summary to memory:', memError);
                }
                context.conversationHistory = context.conversationHistory.slice(pruneIndex);
                log.info(`History pruned. ${context.conversationHistory.length} messages remaining.`);
            }
        } catch (error) {
            log.error('Failed to summarize and prune conversation history:', error);
        }
    }
}
