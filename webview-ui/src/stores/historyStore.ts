import { writable, derived } from 'svelte/store';
import { messaging } from '../lib/messaging';

export interface SessionInfo {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
  model: string;
}

interface SessionGroupPayload {
  label: string;
  sessions: Array<Record<string, any>>;
}

interface HistoryStoreState {
  sessions: SessionInfo[];
  isLoading: boolean;
  searchQuery: string;
  currentRequestId: number | null;
}

const initialState: HistoryStoreState = {
  sessions: [],
  isLoading: false,
  searchQuery: '',
  currentRequestId: null,
};

const HISTORY_TIMEOUT_MS = 5000;

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryStoreState>(initialState);
  let requestCounter = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const clearPendingTimeout = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  const mapGroupsToSessions = (groups: SessionGroupPayload[] = []): SessionInfo[] => {
    return groups.flatMap((group) =>
      (group.sessions || []).map((session) => ({
        id: String(session.id),
        title: session.title || session.name || 'Untitled',
        timestamp: Number(session.updatedAt || session.createdAt || Date.now()),
        messageCount: Number(
          session.messageCount ?? (Array.isArray(session.messages) ? session.messages.length : 0)
        ),
        model: session.model || session.metadata?.model || '',
      }))
    );
  };

  return {
    subscribe,

    setSearchQuery(query: string) {
      update((s) => ({ ...s, searchQuery: query }));
    },

    handleSessionsUpdate(payload: { groups?: SessionGroupPayload[] }) {
      clearPendingTimeout();
      const sessions = mapGroupsToSessions(payload.groups || []);
      update((s) => ({
        ...s,
        sessions,
        isLoading: false,
        currentRequestId: null,
      }));
    },

    fetchHistory() {
      const requestId = ++requestCounter;
      clearPendingTimeout();

      update((s) => ({
        ...s,
        isLoading: true,
        currentRequestId: requestId,
      }));

      messaging.send('getSessions');

      timeoutHandle = setTimeout(() => {
        update((s) => {
          if (s.currentRequestId !== requestId || !s.isLoading) {
            return s;
          }
          return {
            ...s,
            isLoading: false,
            currentRequestId: null,
          };
        });
      }, HISTORY_TIMEOUT_MS);
    },

    deleteSession(sessionId: string) {
      messaging.send('sessionAction', { action: 'delete', sessionId });
    },

    loadSession(sessionId: string) {
      messaging.send('switchSession', { sessionId });
    },

    clear() {
      clearPendingTimeout();
      set(initialState);
    },
  };
}

export const historyStore = createHistoryStore();

export const filteredSessions = derived(historyStore, ($s) => {
  if (!$s.searchQuery) return $s.sessions;
  const query = $s.searchQuery.toLowerCase();
  return $s.sessions.filter(
    (sess) =>
      sess.title.toLowerCase().includes(query) ||
      sess.model.toLowerCase().includes(query)
  );
});
