// =====================================================
// Session Handler - Refactored for new SessionManager API
// =====================================================

import { HistoryManager, SessionType, SessionStatus, Session } from '../../../services/HistoryManager';
import { ModelPricing, OpenRouterService } from '../../../services/OpenRouterService';
import { Mutex } from '../../../core/state/Mutex';

class MutexTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`Session operation "${operation}" timed out after ${timeoutMs}ms while waiting for lock.`);
    this.name = 'MutexTimeoutError';
  }
}

export class SessionHandler {
  private readonly sessionMutex = new Mutex();
  private readonly sessionLockTimeoutMs = 3000;
  private latestSwitchToken = 0;

  constructor(
    private readonly sessionManager: HistoryManager,
    private readonly sendMessageToWebview: (message: any) => void,
    private readonly applyRuntimeSessionState?: (messages: any[], model: string | null) => Promise<void>,
    private readonly openRouterService?: OpenRouterService,
    private readonly getCurrentSelectedModel?: () => string | null
  ) { }

  private normalizeSessionModel(model: unknown): string | null {
    if (typeof model !== 'string') return null;
    const trimmed = model.trim();
    if (!trimmed) return null;
    if (trimmed === 'unknown' || trimmed === 'glm-4.6' || trimmed === 'deepseek-chat') return null;
    return /^[^/\s]+\/[^/\s]+$/.test(trimmed) ? trimmed : null;
  }

  private getGlobalSelectedModel(): string | null {
    if (!this.getCurrentSelectedModel) return null;
    return this.normalizeSessionModel(this.getCurrentSelectedModel());
  }

  private async withSessionLock<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await this.sessionMutex.runExclusive(async () => fn(), this.sessionLockTimeoutMs);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Mutex acquire timeout')) {
        throw new MutexTimeoutError(operation, this.sessionLockTimeoutMs);
      }
      throw error;
    }
  }

  private emitSessionBusy(operation: string): void {
    this.sendMessageToWebview({
      type: 'info',
      message: `Session operation "${operation}" is busy. Please retry.`
    });
  }

  private resolveRuntimeModel(sessionModel: unknown): string | null {
    return this.normalizeSessionModel(sessionModel) || this.getGlobalSelectedModel();
  }

  async handleGetSessions(options?: { suppressActiveMessagesLoad?: boolean }): Promise<void> {
    try {
      console.log('[SessionHandler] Getting sessions...');
      // Force refresh of sessions from storage
      await this.refreshSessions();

      // Get chat sessions from new SessionManager API
      const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
      console.log(`[SessionHandler] Retrieved ${chatSessions.length} chat sessions`);

      // Get active session
      const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
      const activeSessionId = activeSession?.id || null;
      console.log(`[SessionHandler] Active session ID: ${activeSessionId}`);

      // Convert to format expected by UI
      const sessions = chatSessions.map((session: Session) => {
        const chatSession = session as any; // Cast to access ChatSession properties
        const messageCount = chatSession.messages?.length || 0;
        console.log(`[SessionHandler] Session ${session.id} has ${messageCount} messages`);
        return {
          id: session.id,
          title: session.name || 'Untitled',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          model: this.normalizeSessionModel(session.metadata.model) || '',
          messages: chatSession.messages || [],
          messageCount,
          agentMode: session.metadata.agentMode || false,
          isArchived: session.status === 'archived',
          isPinned: session.metadata.isPinned || false
        };
      });

      // Group sessions by status (pinned, recent, archived)
      const pinnedSessions = sessions.filter((s: any) => s.isPinned && !s.isArchived);
      const recentSessions = sessions
        .filter((s: any) => !s.isPinned && !s.isArchived)
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt);
      const archivedSessions = sessions.filter((s: any) => s.isArchived);

      const groups = [];
      if (pinnedSessions.length > 0) {
        groups.push({
          label: 'Pinned',
          sessions: pinnedSessions
        });
      }
      if (recentSessions.length > 0) {
        groups.push({
          label: 'Recent',
          sessions: recentSessions
        });
      }
      if (archivedSessions.length > 0) {
        groups.push({
          label: 'Archived',
          sessions: archivedSessions
        });
      }

      console.log(`[SessionHandler] Sending ${groups.length} session groups to UI`);
      this.sendMessageToWebview({
        type: 'sessionsUpdate',
        groups, // Send as groups as expected by the UI
        activeSessionId
      });

      // Also send messages from active session to UI
      const activeChatSession = activeSession as any; // Cast to access ChatSession properties
      if (!options?.suppressActiveMessagesLoad && activeChatSession && activeChatSession.messages && activeChatSession.messages.length > 0) {
        console.log(`[SessionHandler] Sending ${activeChatSession.messages.length} messages from active session to UI`);
        this.sendMessageToWebview({
          type: 'loadMessages',
          messages: activeChatSession.messages
        });
      }

      if (activeSession && this.applyRuntimeSessionState) {
        await this.applyRuntimeSessionState(
          activeChatSession?.messages || [],
          this.resolveRuntimeModel(activeSession.metadata?.model)
        );
      }

      if (activeSession) {
        await this.sendTokenUsageForSession(activeSession);
      }

      // Restore tasks and context to UI and ContextManager if active session has them saved
      if (activeSession) {
        this.sendMessageToWebview({
          type: 'restoreSessionState',
          tasks: activeSession.metadata.tasks,
          context: activeSession.metadata.context
        });
      }
    } catch (error) {
      console.error('[SessionHandler] Error getting sessions:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to load sessions'
      });
    }
  }

  /**
   * Force refresh sessions from storage
   */
  async refreshSessions(): Promise<void> {
    try {
      console.log('[SessionHandler] Forcing session refresh...');
      // Use SessionManager's refreshSessions method
      await this.sessionManager.refreshSessions();
      console.log('[SessionHandler] Session refresh completed');
    } catch (error) {
      console.error('[SessionHandler] Error refreshing sessions:', error);
    }
  }

  async handleNewSession(): Promise<void> {
    try {
      await this.withSessionLock('newSession', async () => {
        console.log('[SessionHandler] Creating new session...');
        this.sendMessageToWebview({
          type: 'clearMessages'
        });
        const selectedModel = this.resolveRuntimeModel(null);
        const sessionData = {
          name: 'New Chat',
          temperature: 0.7,
          maxTokens: 4000,
          metadata: {
            tokenUsage: this.getDefaultTokenUsage(),
            ...(selectedModel ? { model: selectedModel } : {})
          }
        };

        const session = await this.sessionManager.createSession(SessionType.CHAT, sessionData);
        console.log(`[SessionHandler] Created new session: ${session.id}`);
        await this.sessionManager.setActiveSession(SessionType.CHAT, session.id);
        console.log(`[SessionHandler] Set active session: ${session.id}`);

        this.sendMessageToWebview({
          type: 'restoreSessionState',
          tasks: null,
          context: null
        });

        if (this.applyRuntimeSessionState) {
          await this.applyRuntimeSessionState([], this.resolveRuntimeModel(session.metadata?.model));
        }

        await this.sendTokenUsageForSession(session);
        await this.handleGetSessions({ suppressActiveMessagesLoad: true });
      });
    } catch (error) {
      if (error instanceof MutexTimeoutError) {
        this.emitSessionBusy('newSession');
        return;
      }
      console.error('[SessionHandler] Error creating new session:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to create new session'
      });
    }
  }

  private async handleSwitchSessionInternal(sessionId: string, switchToken: number): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      console.error(`[SessionHandler] Session not found: ${sessionId}`);
      return;
    }

    console.log(`[SessionHandler] Switching to session ${sessionId}`);
    const chatSession = session as any; // Cast to access ChatSession properties
    console.log(`[SessionHandler] Session has ${chatSession.messages?.length || 0} messages`);

    const messageCounts = {
      user: 0,
      assistant: 0,
      system: 0,
      'command-approval': 0,
      'tool-execution': 0
    };

    if (chatSession.messages) {
      chatSession.messages.forEach((m: any) => {
        if (m.role in messageCounts) {
          (messageCounts as any)[m.role]++;
        }
      });
    }

    console.log('[SessionHandler] Message breakdown:', messageCounts);
    await this.sessionManager.setActiveSession(SessionType.CHAT, sessionId);

    const messages = chatSession.messages || [];
    if (switchToken !== this.latestSwitchToken) {
      console.log(`[SessionHandler] Ignoring stale switch load for ${sessionId}`);
      return;
    }
    this.sendMessageToWebview({
      type: 'loadMessages',
      messages
    });

    if (this.applyRuntimeSessionState) {
      await this.applyRuntimeSessionState(
        messages,
        this.resolveRuntimeModel(session.metadata?.model)
      );
    }

    this.sendMessageToWebview({
      type: 'restoreSessionState',
      tasks: session.metadata.tasks,
      context: session.metadata.context
    });

    await this.handleGetSessions({ suppressActiveMessagesLoad: true });
    console.log(`[SessionHandler] Switched to session: ${sessionId}`);
  }

  async handleSwitchSession(sessionId: string): Promise<void> {
    const switchToken = ++this.latestSwitchToken;
    try {
      await this.withSessionLock('switchSession', async () => {
        this.sendMessageToWebview({ type: 'clearMessages' });
        await this.handleSwitchSessionInternal(sessionId, switchToken);
      });
    } catch (error) {
      if (error instanceof MutexTimeoutError) {
        this.emitSessionBusy('switchSession');
        return;
      }
      console.error('[SessionHandler] Error switching session:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to switch session'
      });
    }
  }

  async handleSessionAction(action: string, sessionId: string, payload?: any): Promise<void> {
    try {
      console.log(`[SessionHandler] Handling session action: ${action} for session: ${sessionId}`);
      if (action === 'clearAll') {
        await this.handleClearAllSessions();
        return;
      }

      await this.withSessionLock(`sessionAction:${action}`, async () => {
        const session = await this.sessionManager.getSession(sessionId);
        if (!session) {
          console.error(`[SessionHandler] Session not found: ${sessionId}`);
          return;
        }

        switch (action) {
          case 'rename':
            console.log(`[SessionHandler] Renaming session to: ${payload.title}`);
            await this.sessionManager.updateSession(sessionId, {
              name: payload.title
            });
            break;
          case 'delete': {
            console.log(`[SessionHandler] Deleting session: ${sessionId}`);
            await this.sessionManager.deleteSession(sessionId);
            console.log(`[SessionHandler] Session deleted successfully: ${sessionId}`);
            this.sendMessageToWebview({ type: 'clearMessages' });

            const allSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
            console.log(`[SessionHandler] Found ${allSessions.length} remaining sessions`);
            if (allSessions.length > 0) {
              const recentSession = allSessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
              console.log(`[SessionHandler] Switching to most recent session: ${recentSession.id}`);
              const switchToken = ++this.latestSwitchToken;
              await this.handleSwitchSessionInternal(recentSession.id, switchToken);
            } else {
              console.log(`[SessionHandler] No sessions left - user must create one manually`);
              if (this.applyRuntimeSessionState) {
                await this.applyRuntimeSessionState([], this.resolveRuntimeModel(null));
              }
              await this.sendTokenUsageEmpty();
            }
            break;
          }
          case 'pin':
          case 'unpin':
            console.log(`[SessionHandler] ${action === 'pin' ? 'Pinning' : 'Unpinning'} session: ${sessionId}`);
            await this.sessionManager.updateSession(sessionId, {
              metadata: {
                ...session.metadata,
                isPinned: action === 'pin'
              }
            });
            break;
          case 'archive':
          case 'unarchive':
            console.log(`[SessionHandler] ${action === 'archive' ? 'Archiving' : 'Unarchiving'} session: ${sessionId}`);
            await this.sessionManager.updateSession(sessionId, {
              status: (action === 'archive' ? SessionStatus.ARCHIVED : SessionStatus.ACTIVE) as SessionStatus,
              metadata: {
                ...session.metadata
              }
            });
            break;
        }

        console.log(`[SessionHandler] Updating sessions list after action: ${action}`);
        await this.handleGetSessions({ suppressActiveMessagesLoad: action === 'delete' });
        console.log(`[SessionHandler] Sessions list updated successfully`);
      });
    } catch (error) {
      if (error instanceof MutexTimeoutError) {
        this.emitSessionBusy(`sessionAction:${action}`);
        return;
      }
      console.error('[SessionHandler] Error handling session action:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to update session'
      });
    }
  }

  /**
   * Clear all chat sessions
   */
  async handleClearAllSessions(): Promise<void> {
    try {
      await this.withSessionLock('clearAllSessions', async () => {
        this.sendMessageToWebview({
          type: 'clearMessages'
        });
        console.log('[SessionHandler] Clearing all chat sessions...');
        const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
        console.log(`[SessionHandler] Found ${chatSessions.length} chat sessions to delete`);

        for (const session of chatSessions) {
          await this.sessionManager.deleteSession(session.id);
          console.log(`[SessionHandler] Deleted session: ${session.id}`);
        }

        if (this.applyRuntimeSessionState) {
          await this.applyRuntimeSessionState([], this.resolveRuntimeModel(null));
        }

        await this.handleGetSessions({ suppressActiveMessagesLoad: true });
        console.log('[SessionHandler] All chat sessions cleared successfully');
        this.sendMessageToWebview({
          type: 'info',
          message: 'All chat sessions cleared'
        });
      });
    } catch (error) {
      if (error instanceof MutexTimeoutError) {
        this.emitSessionBusy('clearAllSessions');
        return;
      }
      console.error('[SessionHandler] Error clearing all sessions:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to clear all sessions'
      });
    }
  }

  async handleSearchSessions(query: string): Promise<void> {
    try {
      // Get all chat sessions
      const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);

      // Filter sessions by search query
      const filteredSessions = chatSessions.filter(session => {
        const chatSession = session as any; // Cast to access ChatSession properties
        const title = session.name || '';
        const lastMessage = chatSession.messages?.[chatSession.messages.length - 1]?.content || '';
        return title.toLowerCase().includes(query.toLowerCase()) ||
          lastMessage.toLowerCase().includes(query.toLowerCase());
      });

      // Get active session
      const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
      const activeSessionId = activeSession?.id || null;

      // Convert to format expected by UI
      const sessions = filteredSessions.map(session => {
        const chatSession = session as any; // Cast to access ChatSession properties
        return {
          id: session.id,
          title: session.name || 'Untitled',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          model: this.normalizeSessionModel(session.metadata.model) || '',
          messages: chatSession.messages || [],
          messageCount: chatSession.messages?.length || 0,
          agentMode: session.metadata.agentMode || false,
          isArchived: session.status === 'archived',
          isPinned: session.metadata.isPinned || false
        };
      });

      // Group filtered sessions
      const pinnedSessions = sessions.filter((s: any) => s.isPinned && !s.isArchived);
      const recentSessions = sessions
        .filter((s: any) => !s.isPinned && !s.isArchived)
        .sort((a: any, b: any) => b.updatedAt - a.updatedAt);
      const archivedSessions = sessions.filter((s: any) => s.isArchived);

      const groups = [];
      if (pinnedSessions.length > 0) {
        groups.push({
          label: 'Pinned',
          sessions: pinnedSessions
        });
      }
      if (recentSessions.length > 0) {
        groups.push({
          label: 'Recent',
          sessions: recentSessions
        });
      }
      if (archivedSessions.length > 0) {
        groups.push({
          label: 'Archived',
          sessions: archivedSessions
        });
      }

      this.sendMessageToWebview({
        type: 'sessionsUpdate',
        groups,
        activeSessionId
      });
    } catch (error) {
      console.error('[SessionHandler] Error searching sessions:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to search sessions'
      });
    }
  }

  async addMessageToSession(sessionId: string, message: any): Promise<void> {
    try {
      console.log(`[SessionHandler] Adding message to session: ${sessionId}`);
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        console.error(`[SessionHandler] Session not found: ${sessionId}`);
        return;
      }

      // Use the ChatSessionProvider's addMessage method
      const chatProvider = this.sessionManager.getChatProvider();
      await chatProvider.addMessage(sessionId, {
        role: message.role,
        content: message.content,
        metadata: {
          fileReferences: message.fileReferences,
          toolCalls: message.toolCalls,
          checkpoint: message.checkpoint,
          isStreaming: message.isStreaming,
          isSystemMessage: message.isSystemMessage,
          commandApproval: message.commandApproval,
          toolExecution: message.toolExecution
        }
      });
      console.log(`[SessionHandler] Message added to session: ${sessionId}`);
    } catch (error) {
      console.error('[SessionHandler] Error adding message to session:', error);
    }
  }

  async updateMessageInSession(sessionId: string, messageId: string, updates: any): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) return;

      const chatSession = session as any; // Cast to access ChatSession properties
      const messages = chatSession.messages || [];
      const messageIndex = messages.findIndex((m: any) => m.id === messageId);
      if (messageIndex !== -1) {
        // Update the message directly
        messages[messageIndex] = { ...messages[messageIndex], ...updates };

        await this.sessionManager.updateSession(sessionId, {
          messages
        } as any);

        console.log(`[SessionHandler] Updated message in session: ${messageId}`);
      }
    } catch (error) {
      console.error('[SessionHandler] Error updating message in session:', error);
    }
  }

  async getActiveSession(): Promise<any> {
    try {
      return await this.sessionManager.getActiveSession(SessionType.CHAT);
    } catch (error) {
      console.error('[SessionHandler] Error getting active session:', error);
      return null;
    }
  }

  async getSession(sessionId: string): Promise<any> {
    try {
      return await this.sessionManager.getSession(sessionId);
    } catch (error) {
      console.error('[SessionHandler] Error getting session:', error);
      return null;
    }
  }

  async getAllSessions(): Promise<any[]> {
    try {
      const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
      return chatSessions.map(session => ({
        ...session,
        ...session.metadata
      }));
    } catch (error) {
      console.error('[SessionHandler] Error getting all sessions:', error);
      return [];
    }
  }

  /**
   * Export session to JSON
   */
  async exportSession(sessionId: string): Promise<string | null> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) return null;

      const chatSession = session as any; // Cast to access ChatSession properties

      return JSON.stringify({
        id: session.id,
        title: session.name || 'Untitled',
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messages: chatSession.messages || [],
        agentMode: session.metadata.agentMode || false,
        isArchived: session.status === 'archived',
        isPinned: session.metadata.isPinned || false
      }, null, 2);
    } catch (error) {
      console.error('[SessionHandler] Error exporting session:', error);
      return null;
    }
  }

  /**
   * Import session from JSON
   */
  async importSession(sessionJson: string): Promise<boolean> {
    try {
      const sessionData = JSON.parse(sessionJson);

      // Create new session with imported data
      const newSessionData = {
        name: sessionData.title || 'Imported Session',
        temperature: 0.7,
        maxTokens: 4000
      };

      const newSession = await this.sessionManager.createSession(SessionType.CHAT, newSessionData);

      // If messages were imported, add them to the session
      if (sessionData.messages && sessionData.messages.length > 0) {
        for (const message of sessionData.messages) {
          await this.addMessageToSession(newSession.id, message);
        }
      }

      console.log(`[SessionHandler] Imported session created: ${newSession.id}`);
      return true;
    } catch (error) {
      console.error('[SessionHandler] Error importing session:', error);
      return false;
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(sessionId: string): Promise<any> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) return null;

      const chatSession = session as any; // Cast to access ChatSession properties
      const messages = chatSession.messages || [];
      const messageCounts = {
        user: 0,
        assistant: 0,
        system: 0,
        'command-approval': 0,
        'tool-execution': 0
      };

      let totalTokens = 0;
      let totalFiles = 0;

      messages.forEach((message: any) => {
        if (message.role in messageCounts) {
          (messageCounts as any)[message.role]++;
        }

        // Estimate tokens (rough calculation: 1 token ≈ 4 characters)
        totalTokens += Math.ceil(message.content.length / 4);

        // Count file references
        if (message.fileReferences) {
          totalFiles += message.fileReferences.length;
        }
      });

      return {
        messageCount: messages.length,
        messageCounts,
        estimatedTokens: totalTokens,
        totalFileReferences: totalFiles,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        duration: session.updatedAt - session.createdAt
      };
    } catch (error) {
      console.error('[SessionHandler] Error getting session stats:', error);
      return null;
    }
  }

  async updateSessionMetadata(metadataUpdate: Record<string, any>): Promise<void> {
    try {
      const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
      if (activeSession) {
        await this.sessionManager.updateSession(activeSession.id, {
          metadata: { ...activeSession.metadata, ...metadataUpdate }
        });
      }
    } catch (error) {
      console.error('[SessionHandler] Error updating session metadata:', error);
    }
  }

  async updateSessionWithPlan(planId: string): Promise<void> {
    await this.updateSessionMetadata({
      activePlanId: planId,
      lastPlanUpdate: new Date().toISOString()
    });
  }

  async sendActiveSessionTokenUsage(): Promise<void> {
    const activeSession = await this.sessionManager.getActiveSession(SessionType.CHAT);
    if (activeSession) {
      await this.sendTokenUsageForSession(activeSession);
      return;
    }
    await this.sendTokenUsageEmpty();
  }

  private getDefaultTokenUsage() {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      currentContextTokens: 0,
      modelContextLength: 0,
      compressionLevel: 'none' as 'none' | 'proactive' | 'aggressive',
      warnings: [] as string[],
      estimatedCostUsd: null,
      lastUpdated: Date.now()
    };
  }

  private getTokenUsageFromSession(session: Session) {
    const usage = session.metadata?.tokenUsage;
    return {
      promptTokens: Number(usage?.promptTokens || 0),
      completionTokens: Number(usage?.completionTokens || 0),
      totalTokens: Number(usage?.totalTokens || 0),
      cacheReadInputTokens: Number(usage?.cacheReadInputTokens || 0),
      cacheWriteInputTokens: Number(usage?.cacheWriteInputTokens || 0),
      currentContextTokens: Number(usage?.currentContextTokens || 0),
      modelContextLength: Number(usage?.modelContextLength || 0),
      compressionLevel: usage?.compressionLevel === 'aggressive'
        ? 'aggressive'
        : usage?.compressionLevel === 'proactive'
          ? 'proactive'
          : 'none' as 'none' | 'proactive' | 'aggressive',
      warnings: Array.isArray(usage?.warnings)
        ? usage.warnings.filter((item: unknown) => typeof item === 'string')
        : [] as string[],
      estimatedCostUsd: usage?.estimatedCostUsd == null ? null : Number(usage.estimatedCostUsd),
      lastUpdated: Number(usage?.lastUpdated || 0)
    };
  }

  private async sendTokenUsageForSession(session: Session): Promise<void> {
    const modelId = this.resolveRuntimeModel(session.metadata?.model);
    const usage = this.getTokenUsageFromSession(session);
    const maxTokens = modelId && this.openRouterService
      ? await this.openRouterService.getContextLength(modelId)
      : 200000;
    const pricing = modelId && this.openRouterService
      ? await this.openRouterService.getModelPricing(modelId)
      : null;
    const cost = usage.estimatedCostUsd ?? this.calculateEstimatedCost(usage, pricing);

    this.sendMessageToWebview({
      type: 'tokenTrackerUpdate',
      usage,
      currentContextTokens: usage.currentContextTokens,
      modelContextLength: maxTokens,
      sessionPromptTokens: usage.promptTokens,
      sessionCompletionTokens: usage.completionTokens,
      sessionTotalTokens: usage.totalTokens,
      compressionLevel: usage.compressionLevel,
      warnings: usage.warnings,
      maxTokens,
      pricing,
      cost
    });
  }

  private async sendTokenUsageEmpty(): Promise<void> {
    this.sendMessageToWebview({
      type: 'tokenTrackerUpdate',
      usage: this.getDefaultTokenUsage(),
      currentContextTokens: 0,
      modelContextLength: 200000,
      sessionPromptTokens: 0,
      sessionCompletionTokens: 0,
      sessionTotalTokens: 0,
      compressionLevel: 'none',
      warnings: [],
      maxTokens: 200000,
      pricing: null,
      cost: null
    });
  }

  private calculateEstimatedCost(
    usage: {
      promptTokens: number;
      completionTokens: number;
      cacheReadInputTokens: number;
      cacheWriteInputTokens: number;
    },
    pricing: ModelPricing | null
  ): number | null {
    if (!pricing) return null;
    const promptPrice = pricing.prompt ?? 0;
    const completionPrice = pricing.completion ?? 0;
    const cacheReadPrice = pricing.cache_read ?? 0;
    const cacheWritePrice = pricing.cache_write ?? 0;
    if (![promptPrice, completionPrice, cacheReadPrice, cacheWritePrice].some((v) => v > 0)) {
      return null;
    }

    return (
      (promptPrice / 1_000_000) * usage.promptTokens +
      (completionPrice / 1_000_000) * usage.completionTokens +
      (cacheReadPrice / 1_000_000) * usage.cacheReadInputTokens +
      (cacheWritePrice / 1_000_000) * usage.cacheWriteInputTokens
    );
  }
}
