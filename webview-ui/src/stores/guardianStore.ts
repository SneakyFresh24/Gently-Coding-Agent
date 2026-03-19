import { writable, derived } from 'svelte/store';

export interface GuardianEvent {
  id: string;
  type: 'security' | 'performance' | 'policy';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  timestamp: number;
  status: 'active' | 'resolved' | 'ignored';
  actionTaken?: string;
}

interface GuardianStoreState {
  events: GuardianEvent[];
  isScanning: boolean;
  lastScanTime: number | null;
  filters: {
    type: string[];
    severity: string[];
  };
}

const initialState: GuardianStoreState = {
  events: [
    {
      id: '1',
      type: 'security',
      severity: 'high',
      title: 'Suspicious Terminal Command',
      description: 'An attempt to access sensitive system files was blocked.',
      timestamp: Date.now() - 3600000,
      status: 'active'
    },
    {
      id: '2',
      type: 'performance',
      severity: 'medium',
      title: 'High CPU Usage',
      description: 'The background indexer is consuming more resources than usual.',
      timestamp: Date.now() - 7200000,
      status: 'active'
    },
    {
      id: '3',
      type: 'policy',
      severity: 'low',
      title: 'Missing RLS Policy',
      description: 'Database table "users" is missing a Row Level Security policy.',
      timestamp: Date.now() - 10800000,
      status: 'active'
    }
  ],
  isScanning: false,
  lastScanTime: Date.now() - 10800000,
  filters: {
    type: ['security', 'performance', 'policy'],
    severity: ['critical', 'high', 'medium', 'low'],
  },
};

function createGuardianStore() {
  const { subscribe, set, update } = writable<GuardianStoreState>(initialState);

  return {
    subscribe,

    addEvent(event: GuardianEvent) {
      update(s => ({
        ...s,
        events: [event, ...s.events],
      }));
    },

    updateEvent(id: string, updates: Partial<GuardianEvent>) {
      update(s => ({
        ...s,
        events: s.events.map(e => e.id === id ? { ...e, ...updates } : e),
      }));
    },

    setScanning(isScanning: boolean) {
      update(s => ({ 
        ...s, 
        isScanning,
        lastScanTime: isScanning ? s.lastScanTime : Date.now()
      }));
    },

    setFilters(filters: Partial<GuardianStoreState['filters']>) {
      update(s => ({
        ...s,
        filters: { ...s.filters, ...filters },
      }));
    },

    clear() {
      set(initialState);
    },
  };
}

export const guardianStore = createGuardianStore();

// ── Derived Stores ───────────────────────────────────

export const activeEvents = derived(
  guardianStore,
  $s => $s.events.filter(e => e.status === 'active')
);

export const criticalCount = derived(
  guardianStore,
  $s => $s.events.filter(e => e.severity === 'critical' && e.status === 'active').length
);

export const filteredEvents = derived(
  guardianStore,
  $s => $s.events.filter(e => 
    $s.filters.type.includes(e.type) && 
    $s.filters.severity.includes(e.severity)
  )
);
