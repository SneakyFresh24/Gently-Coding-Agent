import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogService } from './LogService';

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
    type: SessionType;
    timestamp: number;
    createdAt: number;
    updatedAt: number;
    tokens?: number;
    status: SessionStatus | string;
    metadata: Record<string, any>;
    messages: any[];
}

type ActiveSessionMap = Partial<Record<SessionType, string>>;

export class HistoryManager {
    private readonly log = new LogService('HistoryManager');
    private readonly sessionsDir: string;
    private readonly activeSessionsFilePath: string;
    private readonly sessionsCache = new Map<string, Session>();
    private activeSessions: ActiveSessionMap = {};
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private context: vscode.ExtensionContext) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceRoot) {
            this.sessionsDir = path.join(workspaceRoot, '.gently', 'sessions');
        } else if (context.globalStorageUri?.fsPath) {
            this.sessionsDir = path.join(context.globalStorageUri.fsPath, 'sessions');
        } else {
            this.sessionsDir = path.join(process.cwd(), '.gently', 'sessions');
        }
        this.activeSessionsFilePath = path.join(this.sessionsDir, 'active-sessions.json');
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.ensureSessionsDir();
        await this.refreshSessions();
        this.initialized = true;
    }

    private async ensureSessionsDir(): Promise<void> {
        await fs.promises.mkdir(this.sessionsDir, { recursive: true });
    }

    private sessionFilePath(sessionId: string): string {
        return path.join(this.sessionsDir, `${sessionId}.json`);
    }

    private clone<T>(value: T): T {
        if (typeof globalThis.structuredClone === 'function') {
            return globalThis.structuredClone(value);
        }
        return JSON.parse(JSON.stringify(value)) as T;
    }

    private enqueueWrite(op: () => Promise<void>): Promise<void> {
        this.writeQueue = this.writeQueue.then(op).catch((error) => {
            this.log.error('Queued write failed', error);
        });
        return this.writeQueue;
    }

    private normalizeSession(raw: any, fallbackId?: string): Session | null {
        if (!raw || typeof raw !== 'object') {
            return null;
        }

        const now = Date.now();
        const createdAt = typeof raw.createdAt === 'number'
            ? raw.createdAt
            : (typeof raw.timestamp === 'number' ? raw.timestamp : now);
        const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt;
        const id = typeof raw.id === 'string' && raw.id.trim().length > 0
            ? raw.id
            : (fallbackId || `session_${now}`);
        const name = typeof raw.name === 'string' && raw.name.trim().length > 0
            ? raw.name
            : (typeof raw.title === 'string' && raw.title.trim().length > 0 ? raw.title : 'Untitled');
        const metadata = (raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata))
            ? raw.metadata
            : {};

        return {
            id,
            name,
            title: typeof raw.title === 'string' ? raw.title : undefined,
            type: raw.type === SessionType.PLAN ? SessionType.PLAN : SessionType.CHAT,
            timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : createdAt,
            createdAt,
            updatedAt,
            tokens: typeof raw.tokens === 'number' ? raw.tokens : undefined,
            status: raw.status || SessionStatus.ACTIVE,
            metadata,
            messages: Array.isArray(raw.messages) ? raw.messages : []
        };
    }

    private async persistSession(session: Session): Promise<void> {
        const filePath = this.sessionFilePath(session.id);
        await this.enqueueWrite(async () => {
            await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
        });
    }

    private async persistActiveSessions(): Promise<void> {
        await this.enqueueWrite(async () => {
            await fs.promises.writeFile(this.activeSessionsFilePath, JSON.stringify(this.activeSessions, null, 2), 'utf8');
        });
    }

    private async loadActiveSessions(): Promise<void> {
        try {
            const raw = await fs.promises.readFile(this.activeSessionsFilePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                this.activeSessions = parsed as ActiveSessionMap;
            } else {
                this.activeSessions = {};
            }
        } catch {
            this.activeSessions = {};
        }
    }

    private async loadSessionsFromDisk(): Promise<void> {
        this.sessionsCache.clear();
        let entries: string[] = [];
        try {
            entries = await fs.promises.readdir(this.sessionsDir);
        } catch (error) {
            this.log.error('Failed reading sessions directory', error);
            return;
        }

        for (const entry of entries) {
            if (!entry.endsWith('.json') || entry === 'active-sessions.json') {
                continue;
            }

            const fullPath = path.join(this.sessionsDir, entry);
            try {
                const raw = await fs.promises.readFile(fullPath, 'utf8');
                const parsed = JSON.parse(raw);
                const fallbackId = path.basename(entry, '.json');
                const session = this.normalizeSession(parsed, fallbackId);
                if (!session) {
                    this.log.warn(`Skipping invalid session file: ${entry}`);
                    continue;
                }
                this.sessionsCache.set(session.id, session);
            } catch (error) {
                this.log.error(`Failed parsing session file ${entry}`, error);
            }
        }
    }

    private async normalizeActiveSessions(): Promise<void> {
        const validIds = new Set(this.sessionsCache.keys());
        let changed = false;

        for (const type of [SessionType.CHAT, SessionType.PLAN]) {
            const activeId = this.activeSessions[type];
            if (activeId && validIds.has(activeId)) {
                continue;
            }

            const fallback = Array.from(this.sessionsCache.values())
                .filter((s) => s.type === type)
                .sort((a, b) => b.updatedAt - a.updatedAt)[0];

            const nextId = fallback?.id;
            if (nextId !== this.activeSessions[type]) {
                this.activeSessions[type] = nextId;
                changed = true;
            }
        }

        if (changed) {
            await this.persistActiveSessions();
        }
    }

    public async getSessions(): Promise<Session[]> {
        await this.ensureInitialized();
        return Array.from(this.sessionsCache.values())
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => this.clone(session));
    }

    public async getSessionsByType(type: SessionType): Promise<Session[]> {
        await this.ensureInitialized();
        return Array.from(this.sessionsCache.values())
            .filter((session) => session.type === type)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => this.clone(session));
    }

    public async getActiveSession(type: SessionType): Promise<Session | null> {
        await this.ensureInitialized();
        const activeId = this.activeSessions[type];
        if (!activeId) {
            return null;
        }
        const session = this.sessionsCache.get(activeId);
        return session ? this.clone(session) : null;
    }

    public async setActiveSession(type: SessionType, sessionId: string): Promise<void> {
        await this.ensureInitialized();
        const session = this.sessionsCache.get(sessionId);
        if (!session || session.type !== type) {
            this.log.warn(`Cannot set active session: ${sessionId} for type ${type}`);
            return;
        }
        this.activeSessions[type] = sessionId;
        await this.persistActiveSessions();
    }

    public async createSession(type: SessionType, data: any): Promise<Session> {
        await this.ensureInitialized();
        const now = Date.now();
        const sessionId = `session_${now}_${Math.random().toString(36).slice(2, 8)}`;
        const metadata = {
            ...(data?.metadata || {})
        };

        if (data?.model) {
            metadata.model = data.model;
        }

        const session: Session = {
            id: sessionId,
            name: data?.name || 'Untitled',
            title: data?.title,
            type,
            timestamp: now,
            createdAt: now,
            updatedAt: now,
            status: data?.status || SessionStatus.ACTIVE,
            metadata,
            messages: Array.isArray(data?.messages) ? data.messages : [],
            tokens: typeof data?.tokens === 'number' ? data.tokens : undefined
        };

        this.sessionsCache.set(session.id, session);
        await this.persistSession(session);
        this.activeSessions[type] = session.id;
        await this.persistActiveSessions();
        return this.clone(session);
    }

    public async updateSession(sessionId: string, updates: any): Promise<void> {
        await this.ensureInitialized();
        const existing = this.sessionsCache.get(sessionId);
        if (!existing) {
            this.log.warn(`Cannot update missing session: ${sessionId}`);
            return;
        }

        const mergedMetadata = updates?.metadata
            ? { ...existing.metadata, ...updates.metadata }
            : existing.metadata;

        const updated: Session = this.normalizeSession({
            ...existing,
            ...updates,
            metadata: mergedMetadata,
            updatedAt: Date.now(),
        }, sessionId) || existing;

        this.sessionsCache.set(sessionId, updated);
        await this.persistSession(updated);
    }

    public async getSession(sessionId: string): Promise<Session | null> {
        await this.ensureInitialized();
        const session = this.sessionsCache.get(sessionId);
        return session ? this.clone(session) : null;
    }

    private async chooseFallbackActive(type: SessionType): Promise<void> {
        const fallback = Array.from(this.sessionsCache.values())
            .filter((session) => session.type === type)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
        this.activeSessions[type] = fallback?.id;
    }

    public getChatProvider() {
        return {
            addMessage: async (sessionId: string, message: any) => {
                const session = await this.getSession(sessionId);
                if (!session) return;
                const now = Date.now();
                const storedMessage = {
                    id: message?.id || `msg_${now}_${Math.random().toString(36).slice(2, 8)}`,
                    timestamp: message?.timestamp || now,
                    role: message?.role || 'system',
                    content: message?.content || '',
                    ...(message?.metadata || {})
                };
                await this.updateSession(sessionId, {
                    messages: [...(session.messages || []), storedMessage]
                });
            },
            addCommandApprovalMessage: async (sessionId: string, approval: any) => {
                await this.getChatProvider().addMessage(sessionId, {
                    role: 'command-approval',
                    content: approval?.command || 'Command approval',
                    commandApproval: approval
                });
            },
            updateCommandApprovalMessage: async (sessionId: string, commandId: string, status: string) => {
                const session = await this.getSession(sessionId);
                if (!session) return;
                const messages = (session.messages || []).map((msg: any) => {
                    if (msg?.commandApproval?.commandId === commandId) {
                        return {
                            ...msg,
                            commandApproval: {
                                ...msg.commandApproval,
                                status
                            }
                        };
                    }
                    return msg;
                });
                await this.updateSession(sessionId, { messages });
            },
            addToolExecutionMessage: async (sessionId: string, execution: any) => {
                await this.getChatProvider().addMessage(sessionId, {
                    role: 'tool-execution',
                    content: execution?.toolName || 'Tool execution',
                    toolExecution: execution
                });
            },
            updateToolExecutionMessage: async (sessionId: string, toolName: string, updates: any) => {
                const session = await this.getSession(sessionId);
                if (!session) return;
                const messages = (session.messages || []).map((msg: any) => {
                    if (msg?.toolExecution?.toolName === toolName) {
                        return {
                            ...msg,
                            toolExecution: {
                                ...msg.toolExecution,
                                ...updates
                            }
                        };
                    }
                    return msg;
                });
                await this.updateSession(sessionId, { messages });
            },
            updateSession: async (sessionId: string, updates: any) => {
                await this.updateSession(sessionId, updates);
            }
        };
    }

    public async refreshSessions(): Promise<void> {
        await this.ensureSessionsDir();
        await this.loadSessionsFromDisk();
        await this.loadActiveSessions();
        await this.normalizeActiveSessions();
    }

    public async deleteSession(sessionId: string): Promise<void> {
        await this.ensureInitialized();
        const target = this.sessionsCache.get(sessionId);
        this.sessionsCache.delete(sessionId);
        const sessionPath = this.sessionFilePath(sessionId);

        try {
            await fs.promises.unlink(sessionPath);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                this.log.error(`Failed deleting session file ${sessionId}`, error);
            }
        }

        if (target) {
            for (const type of [SessionType.CHAT, SessionType.PLAN]) {
                if (this.activeSessions[type] === sessionId) {
                    await this.chooseFallbackActive(type);
                }
            }
            await this.persistActiveSessions();
        }
    }

    public async flush(): Promise<void> {
        await this.writeQueue;
    }

    // Bridge for ChatViewProvider if it needs to send messages
    public sendMessageToWebview(_message: any) {
        // wired externally when needed
    }
}
