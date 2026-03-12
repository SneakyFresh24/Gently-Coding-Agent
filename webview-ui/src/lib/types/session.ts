export interface ChatSession {
    id: string;
    title: string;
    messageCount: number;
    updatedAt: number;
    isPinned: boolean;
    isArchived: boolean;
    agentMode: boolean;
}

export interface SessionGroup {
    label: string;
    sessions: ChatSession[];
}

export type SessionActionType = 'rename' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'delete' | 'clearAll';

export interface SessionActionPayload {
    action: SessionActionType;
    sessionId: string;
    payload?: {
        title?: string;
    };
}
