// =====================================================
// Auto Approve Constants
// =====================================================

export interface ActionMeta {
  id: string;
  label: string;
  shortName: string;
  icon: string;
  subAction?: ActionMeta;
}

export const ACTION_METADATA: ActionMeta[] = [
  {
    id: 'readFiles',
    label: 'Read project files',
    shortName: 'Read',
    icon: 'search',
    subAction: {
      id: 'readFilesExternally',
      label: 'Read all files',
      shortName: 'Read (all)',
      icon: 'folder-opened',
    },
  },
  {
    id: 'editFiles',
    label: 'Edit project files',
    shortName: 'Edit',
    icon: 'edit',
    subAction: {
      id: 'editFilesExternally',
      label: 'Edit all files',
      shortName: 'Edit (all)',
      icon: 'files',
    },
  },
  {
    id: 'executeSafeCommands',
    label: 'Execute safe commands',
    shortName: 'Safe Cmds',
    icon: 'terminal',
    subAction: {
      id: 'executeAllCommands',
      label: 'Execute all commands',
      shortName: 'All Cmds',
      icon: 'terminal-bash',
    },
  },
  {
    id: 'useBrowser',
    label: 'Use the browser',
    shortName: 'Browser',
    icon: 'globe',
  },
  {
    id: 'useMcp',
    label: 'Use MCP servers',
    shortName: 'MCP',
    icon: 'server',
  },
];
