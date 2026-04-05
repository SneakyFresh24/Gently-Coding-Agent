import { describe, expect, it } from 'vitest';
import { AutoApprovalSettings } from '../types/approval';
import { evaluateToolPermissionDecision } from './PermissionPolicy';

function createSettings(overrides?: Partial<AutoApprovalSettings>): AutoApprovalSettings {
  return {
    version: 1,
    enableNotifications: true,
    yoloMode: false,
    actions: {
      readFiles: false,
      readFilesExternally: false,
      editFiles: false,
      editFilesExternally: false,
      executeSafeCommands: false,
      executeAllCommands: false,
      useBrowser: false,
      useMcp: false
    },
    ...overrides
  };
}

describe('PermissionPolicy', () => {
  it('approves unknown tools in yolo mode', () => {
    const decision = evaluateToolPermissionDecision(
      'unknown_tool',
      {},
      createSettings({ yoloMode: true }),
      ['C:\\repo']
    );
    expect(decision.approved).toBe(true);
    expect(decision.reason).toBe('yolo_mode');
  });

  it('classifies write_file outside workspace as external edit policy', () => {
    const decision = evaluateToolPermissionDecision(
      'write_file',
      { path: '..\\outside\\file.txt' },
      createSettings({
        actions: {
          ...createSettings().actions,
          editFiles: true,
          editFilesExternally: false
        }
      }),
      ['C:\\repo']
    );
    expect(decision.policyAction).toBe('editFilesExternally');
    expect(decision.externalPath).toBe(true);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('policy_denied');
  });

  it('maps safe commands to executeSafeCommands policy', () => {
    const decision = evaluateToolPermissionDecision(
      'run_command',
      { command: 'git status' },
      createSettings({
        actions: {
          ...createSettings().actions,
          executeSafeCommands: true,
          executeAllCommands: false
        }
      }),
      ['C:\\repo']
    );
    expect(decision.policyAction).toBe('executeSafeCommands');
    expect(decision.safeCommand).toBe(true);
    expect(decision.approved).toBe(true);
  });

  it('maps mutating commands to executeAllCommands policy', () => {
    const decision = evaluateToolPermissionDecision(
      'run_command',
      { command: 'npm install' },
      createSettings({
        actions: {
          ...createSettings().actions,
          executeSafeCommands: true,
          executeAllCommands: false
        }
      }),
      ['C:\\repo']
    );
    expect(decision.policyAction).toBe('executeAllCommands');
    expect(decision.safeCommand).toBe(false);
    expect(decision.approved).toBe(false);
  });
});
