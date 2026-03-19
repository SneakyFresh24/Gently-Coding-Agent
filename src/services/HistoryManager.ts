import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export enum SessionType {
    CHAT = 'chat',
    PLAN = 'plan'
}

export enum SessionStatus {
    ACTIVE = 'active',
    ARCHIVED = 'archived'
}

export interface Session {
    id: string;
    name: string;
    title?: string;
    timestamp: number;
    createdAt: number;
    updatedAt: number;
    tokens?: number;
    status: string;
    metadata: any;
}

export class HistoryManager {
    private sessionsDir: string;

    constructor(private context: vscode.ExtensionContext) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        this.sessionsDir = path.join(workspaceRoot, '.gently', 'sessions');
        this.ensureSessionsDir();
    }

    private ensureSessionsDir() {
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    public async getSessions(): Promise<Session[]> {
        return [];
    }

    public async getSessionsByType(type: SessionType): Promise<Session[]> {
        return [];
    }

    public async getActiveSession(type: SessionType): Promise<Session | null> {
        return null;
    }

    public async setActiveSession(type: SessionType, sessionId: string): Promise<void> {
    }

    public async createSession(type: SessionType, data: any): Promise<Session> {
        const session: Session = {
            id: `session_${Date.now()}`,
            name: data.name || 'Untitled',
            timestamp: Date.now(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
            metadata: {}
        };
        return session;
    }

    public async updateSession(sessionId: string, updates: any): Promise<void> {
    }

    public getSession(sessionId: string): Promise<Session | null> {
        return Promise.resolve(null);
    }

    public getChatProvider() {
        return {
            addMessage: async (sessionId: string, message: any) => { },
            addCommandApprovalMessage: async (sessionId: string, approval: any) => { },
            updateCommandApprovalMessage: async (sessionId: string, commandId: string, status: string) => { },
            addToolExecutionMessage: async (sessionId: string, execution: any) => { },
            updateToolExecutionMessage: async (sessionId: string, toolName: string, updates: any) => { },
            updateSession: async (sessionId: string, updates: any) => { }
        };
    }

    public async refreshSessions(): Promise<void> { }

    public async deleteSession(sessionId: string): Promise<void> {
        const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionPath)) {
            fs.unlinkSync(sessionPath);
        }
    }

    public async flush(): Promise<void> {
        // Sync pending changes to disk
    }

    // Bridge for ChatViewProvider if it needs to send messages
    public sendMessageToWebview(message: any) {
        // This will be wired up via the ChatViewProvider
    }
}
