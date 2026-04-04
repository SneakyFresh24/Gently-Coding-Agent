import * as vscode from 'vscode';
import { HistoryManager, SessionType, Session } from '../../../services/HistoryManager';
import { Message, ChatViewContext, fromChatMessage } from '../types/ChatTypes';
import { FileReference } from '../../../agent/fileReferenceManager';
import { LogService } from '../../../services/LogService';

const log = new LogService('SessionHistoryManager');

interface QueryRuntimeMetadata {
    flowId?: string;
    turnId?: string;
    phase?: 'start' | 'attempt' | 'boundary' | 'terminal';
    attempt?: number;
    maxAttempts?: number;
    resultCode?: string;
    updatedAt: number;
    boundaries?: Array<{
        at: number;
        reason: string;
        droppedCount: number;
    }>;
}

/**
 * Manages conversation history state and persistence via SessionManager.
 */
export class SessionHistoryManager {
    constructor(
        private readonly extensionContext: vscode.ExtensionContext,
        private readonly sessionManager?: HistoryManager,
        private readonly sendMessageToWebview?: (message: any) => void
    ) {
        log.info(`Constructor called – sessionManager = ${this.sessionManager ? 'EXISTS ✓' : 'MISSING ✗'}`);
    }

    /**
     * Initializes or restores the session.
     */
    async initializeSession(context: ChatViewContext): Promise<void> {
        if (!this.sessionManager) return;

        try {
            const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (activeSession) {
                const chatSession = activeSession as any;
                const messages = chatSession.messages || [];
                context.conversationHistory = messages
                    .filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool')
                    .map((m: any) => ({
                        id: m.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        timestamp: m.timestamp || Date.now(),
                        role: m.role,
                        content: m.content,
                        toolName: m.toolName || m.metadata?.toolName,
                        tool_call_id: m.tool_call_id,
                        tool_calls: m.tool_calls
                    }));
                log.info(`Loaded ${context.conversationHistory.length} messages from active session`);
            }
        } catch (error) {
            log.error('Error initializing session history:', error);
        }
    }

    /**
     * Adds a user message to history and persists it.
     */
    async addMessageToHistory(
        context: ChatViewContext,
        enhancedMessage: string,
        originalMessage: string,
        loadedReferences: FileReference[]
    ): Promise<void> {
        const userMsg: Message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            role: 'user',
            content: enhancedMessage,
        };
        context.conversationHistory.push(userMsg);

        if (this.sessionManager) {
            try {
                let activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
                if (!activeSession) {
                    const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
                    if (chatSessions.length > 0) {
                        activeSession = chatSessions.sort((a: Session, b: Session) => b.updatedAt - a.updatedAt)[0];
                        await this.sessionManager.setActiveSession(SessionType.CHAT, activeSession.id);
                    } else {
                        activeSession = await this.sessionManager.createSession(SessionType.CHAT, {
                            name: originalMessage.length > 50 ? originalMessage.substring(0, 50) + '...' : originalMessage
                        });
                    }
                }

                if (activeSession) {
                    const chatProvider = this.sessionManager.getChatProvider();
                    await chatProvider.addMessage(activeSession.id, {
                        role: 'user',
                        content: originalMessage,
                        metadata: {
                            fileReferences: loadedReferences.map(ref => ({
                                path: ref.path,
                                displayName: ref.displayName,
                                size: ref.size,
                                language: ref.language,
                                diffStats: ref.diffStats
                            }))
                        }
                    });

                    if (this.sendMessageToWebview) {
                        this.sendMessageToWebview({ type: 'refreshSessions' });
                    }
                }
            } catch (error) {
                log.error('Error saving message to session:', error);
            }
        }
    }

    /**
     * Saves a generic message to the session history backend.
     */
    async saveMessageToHistory(message: Message): Promise<void> {
        if (!this.sessionManager) {
            log.warn('Cannot save message to history, session manager is not available');
            return;
        }

        try {
            let activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (!activeSession) {
                // Try to reactivate the most recent existing session first
                const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
                if (chatSessions.length > 0) {
                    activeSession = chatSessions.sort((a: Session, b: Session) => b.updatedAt - a.updatedAt)[0];
                    await this.sessionManager.setActiveSession(SessionType.CHAT, activeSession.id);
                    log.info(`Reactivated existing session: ${activeSession.id}`);
                } else {
                    // No sessions at all — create a new one
                    activeSession = await this.sessionManager.createSession(SessionType.CHAT, {
                        name: 'Chat Session – ' + new Date().toLocaleString()
                    });
                    log.info(`Created new session for message persistence: ${activeSession.id}`);
                }
            }

            const chatProvider = this.sessionManager.getChatProvider();
            await chatProvider.addMessage(activeSession.id, {
                role: message.role as any,
                content: message.content || '',
                metadata: {
                    id: message.id,
                    toolName: message.toolName,
                    tool_calls: message.tool_calls,
                    tool_call_id: message.tool_call_id,
                    fileReferences: message.fileReferences?.map(ref => ({
                        path: ref.path,
                        displayName: ref.displayName,
                        size: ref.size,
                        language: ref.language,
                        diffStats: ref.diffStats
                    }))
                }
            });

            if (this.sendMessageToWebview) {
                this.sendMessageToWebview({ type: 'refreshSessions' });
            }
        } catch (error) {
            log.error('Error saving message to session:', error);
        }
    }

    /**
     * Clears history for a new message flow.
     */
    clearToolExecutionTracking(context: ChatViewContext): void {
        context.toolExecutionStartSent.clear();
    }

    async getActiveSession(type: SessionType) {
        return this.sessionManager?.getActiveSession(type);
    }

    /**
     * Persists the current TaskState to the active session metadata.
     */
    async saveTaskState(taskState: any): Promise<void> {
        if (!this.sessionManager) return;
        try {
            const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (activeSession) {
                const metadata = activeSession.metadata || {};
                metadata.taskState = taskState;
                await this.sessionManager.getChatProvider().updateSession(activeSession.id, { metadata });
                log.info(`TaskState persisted to session ${activeSession.id}`);
            }
        } catch (error) {
            log.error('Error saving TaskState to session:', error);
        }
    }

    /**
     * Restores TaskState from the active session metadata.
     */
    async restoreTaskState(): Promise<any | null> {
        if (!this.sessionManager) return null;
        try {
            const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (activeSession && activeSession.metadata?.taskState) {
                log.info(`TaskState restored from session ${activeSession.id}`);
                return activeSession.metadata.taskState;
            }
        } catch (error) {
            log.error('Error restoring TaskState from session:', error);
        }
        return null;
    }

    getChatProvider() {
        return this.sessionManager?.getChatProvider();
    }

    async saveQueryRuntimeState(update: Partial<QueryRuntimeMetadata>): Promise<void> {
        if (!this.sessionManager) return;
        try {
            const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (!activeSession) return;
            const metadata = activeSession.metadata || {};
            const current: QueryRuntimeMetadata = (metadata.queryRuntime || {
                updatedAt: Date.now(),
                boundaries: []
            }) as QueryRuntimeMetadata;
            metadata.queryRuntime = {
                ...current,
                ...update,
                updatedAt: Date.now(),
                boundaries: Array.isArray(current.boundaries) ? current.boundaries : []
            } as QueryRuntimeMetadata;
            await this.sessionManager.getChatProvider().updateSession(activeSession.id, { metadata });
        } catch (error) {
            log.error('Error saving query runtime state:', error);
        }
    }

    async appendQueryRuntimeBoundary(boundary: { reason: string; droppedCount: number }): Promise<void> {
        if (!this.sessionManager) return;
        try {
            const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
            if (!activeSession) return;
            const metadata = activeSession.metadata || {};
            const current: QueryRuntimeMetadata = (metadata.queryRuntime || {
                updatedAt: Date.now(),
                boundaries: []
            }) as QueryRuntimeMetadata;
            const boundaries = Array.isArray(current.boundaries) ? [...current.boundaries] : [];
            boundaries.push({
                at: Date.now(),
                reason: boundary.reason,
                droppedCount: boundary.droppedCount
            });
            while (boundaries.length > 20) {
                boundaries.shift();
            }
            metadata.queryRuntime = {
                ...current,
                boundaries,
                updatedAt: Date.now(),
                phase: 'boundary'
            } as QueryRuntimeMetadata;
            await this.sessionManager.getChatProvider().updateSession(activeSession.id, { metadata });
        } catch (error) {
            log.error('Error appending query runtime boundary:', error);
        }
    }
}
