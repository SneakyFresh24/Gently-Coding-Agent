import { writable, derived } from 'svelte/store';
import { messaging } from '../lib/messaging';

export interface SessionInfo {
  id: string;
  title: string;
  timestamp: number;
  messageCount: number;
  model: string;
}

interface HistoryStoreState {
  sessions: SessionInfo[];
  isLoading: boolean;
  searchQuery: string;
}

const initialState: HistoryStoreState = {
  sessions: [],
  isLoading: false,
  searchQuery: '',
};

function createHistoryStore() {
  const { subscribe, set, update } = writable<HistoryStoreState>(initialState);

  return {
    subscribe,

    setSessions(sessions: SessionInfo[]) {
      update(s => ({ ...s, sessions, isLoading: false }));
    },

    setLoading(isLoading: boolean) {
      update(s => ({ ...s, isLoading }));
    },

    setSearchQuery(query: string) {
      update(s => ({ ...s, searchQuery: query }));
    },

    fetchHistory() {
      update(s => ({ ...s, isLoading: true }));
      messaging.send('getHistory');
    },

    deleteSession(sessionId: string) {
      messaging.send('deleteSession', { sessionId });
      update(s => ({
        ...s,
        sessions: s.sessions.filter(sess => sess.id !== sessionId)
      }));
    },

    loadSession(sessionId: string) {
      messaging.send('loadSession', { sessionId });
    },

    clear() {
      set(initialState);
    },
  };
}

export const historyStore = createHistoryStore();

// ── Derived Stores ───────────────────────────────────

export const filteredSessions = derived(
  historyStore,
  $s => {
    if (!$s.searchQuery) return $s.sessions;
    const query = $s.searchQuery.toLowerCase();
    return $s.sessions.filter(sess => 
      sess.title.toLowerCase().includes(query) || 
      sess.model.toLowerCase().includes(query)
    );
  }
);
