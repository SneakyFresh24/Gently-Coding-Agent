// =====================================================
// Session Handler - Refactored for new SessionManager API
// =====================================================

import { SessionManager } from '../../../session/SessionManager';
import { SessionType, SessionStatus } from '../../../session/types/SessionTypes';
import { Message } from '../types/ChatTypes';

export class SessionHandler {
  constructor(
    private readonly sessionManager: SessionManager,
    private readonly sendMessageToWebview: (message: any) => void
  ) { }

  async handleGetSessions(): Promise<void> {
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
      const sessions = chatSessions.map(session => {
        const chatSession = session as any; // Cast to access ChatSession properties
        const messageCount = chatSession.messages?.length || 0;
        console.log(`[SessionHandler] Session ${session.id} has ${messageCount} messages`);
        return {
          id: session.id,
          title: session.name || 'Untitled',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
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
      if (activeChatSession && activeChatSession.messages && activeChatSession.messages.length > 0) {
        console.log(`[SessionHandler] Sending ${activeChatSession.messages.length} messages from active session to UI`);
        this.sendMessageToWebview({
          type: 'loadMessages',
          messages: activeChatSession.messages
        });
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
      console.log('[SessionHandler] Creating new session...');
      const sessionData = {
        name: 'New Chat',
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 4000
      };

      const session = await this.sessionManager.createSession(SessionType.CHAT, sessionData);
      console.log(`[SessionHandler] Created new session: ${session.id}`);

      // Set as active session
      await this.sessionManager.setActiveSession(SessionType.CHAT, session.id);
      console.log(`[SessionHandler] Set active session: ${session.id}`);

      // Send updated sessions
      console.log(`[SessionHandler] Getting sessions to update UI`);
      await this.handleGetSessions();
      console.log(`[SessionHandler] Sessions updated in UI`);

      // Clear messages and state in UI
      this.sendMessageToWebview({
        type: 'clearMessages'
      });
      this.sendMessageToWebview({
        type: 'restoreSessionState',
        tasks: null,
        context: null
      });
    } catch (error) {
      console.error('[SessionHandler] Error creating new session:', error);
      this.sendMessageToWebview({
        type: 'error',
        message: 'Failed to create new session'
      });
    }
  }

  async handleSwitchSession(sessionId: string): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      if (!session) {
        console.error(`[SessionHandler] Session not found: ${sessionId}`);
        return;
      }

      console.log(`[SessionHandler] Switching to session ${sessionId}`);
      const chatSession = session as any; // Cast to access ChatSession properties
      console.log(`[SessionHandler] Session has ${chatSession.messages?.length || 0} messages`);

      // Count message types
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

      // Set as active
      await this.sessionManager.setActiveSession(SessionType.CHAT, sessionId);

      // Send messages to UI
      const messages = chatSession.messages || [];
      console.log(`[SessionHandler] Sending ${messages.length} messages to UI`);
      this.sendMessageToWebview({
        type: 'loadMessages',
        messages
      });

      // Restore specialized session state to store
      this.sendMessageToWebview({
        type: 'restoreSessionState',
        tasks: session.metadata.tasks,
        context: session.metadata.context
      });

      // Update sessions list
      await this.handleGetSessions();

      console.log(`[SessionHandler] Switched to session: ${sessionId}`);
    } catch (error) {
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
        // Handle clearing all sessions
        await this.handleClearAllSessions();
        return;
      }

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
        case 'delete':
          console.log(`[SessionHandler] Deleting session: ${sessionId}`);
          await this.sessionManager.deleteSession(sessionId);
          console.log(`[SessionHandler] Session deleted successfully: ${sessionId}`);

          // Get all remaining sessions
          const allSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
          console.log(`[SessionHandler] Found ${allSessions.length} remaining sessions`);

          if (allSessions.length > 0) {
            // Switch to the most recent session
            const recentSession = allSessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            console.log(`[SessionHandler] Switching to most recent session: ${recentSession.id}`);
            await this.handleSwitchSession(recentSession.id);
          } else {
            console.log(`[SessionHandler] No sessions left - user must create one manually`);
            // Don't create a new session automatically
            // Clear messages in UI
            this.sendMessageToWebview({
              type: 'clearMessages'
            });
          }
          break;
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

      // Update sessions list
      console.log(`[SessionHandler] Updating sessions list after action: ${action}`);
      await this.handleGetSessions();
      console.log(`[SessionHandler] Sessions list updated successfully`);
    } catch (error) {
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
      console.log('[SessionHandler] Clearing all chat sessions...');

      // Get all chat sessions
      const chatSessions = await this.sessionManager.getSessionsByType(SessionType.CHAT);
      console.log(`[SessionHandler] Found ${chatSessions.length} chat sessions to delete`);

      // Delete all chat sessions
      for (const session of chatSessions) {
        await this.sessionManager.deleteSession(session.id);
        console.log(`[SessionHandler] Deleted session: ${session.id}`);
      }

      // Clear messages in UI
      this.sendMessageToWebview({
        type: 'clearMessages'
      });

      // Update sessions list
      await this.handleGetSessions();

      console.log('[SessionHandler] All chat sessions cleared successfully');
      this.sendMessageToWebview({
        type: 'info',
        message: 'All chat sessions cleared'
      });
    } catch (error) {
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
        model: 'deepseek-chat',
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
}
