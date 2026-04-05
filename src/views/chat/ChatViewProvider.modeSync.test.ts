import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn()
  },
  ConfigurationTarget: {
    Global: 1
  }
}));

describe('ChatViewProvider mode transition hardening', () => {
  it('forces architect mode and emits resilience status when code entry gate blocks transition', async () => {
    const configUpdate = vi.fn().mockResolvedValue(undefined);
    const getConfiguration = vi.mocked(vscode.workspace.getConfiguration);
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'modeStateMachineV2') return true;        if (key === 'agentMode') return true;
        return fallback;
      }),
      update: configUpdate
    } as any);

    const postMessage = vi.fn();
    const setSelectedMode = vi.fn();

    const provider = Object.create(ChatViewProvider.prototype) as any;
    provider.modeService = {
      getCurrentMode: vi.fn(() => ({
        id: 'architect',
        displayName: 'Architect',
        description: 'Planning mode'
      })),
      setMode: vi.fn().mockResolvedValue(undefined)
    };
    provider.messageHandler = {
      setSelectedMode,
      getContext: vi.fn(() => ({
        selectedModel: 'openai/gpt-4o-mini',
        currentFlowId: 'flow-mode-block'
      }))
    };
    provider.context = {
      globalState: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };
    provider.agentManager = {
      getPlanningManager: vi.fn(() => ({
        prepareCodeEntry: vi.fn().mockResolvedValue({
          ok: false,
          code: 'PLAN_REQUIRED_FOR_CODE_ENTRY',
          reason: 'No active plan found.'
        })
      }))
    };
    provider._view = {
      webview: {
        postMessage
      }
    };

    await provider.setSelectedMode('code');

    expect(setSelectedMode).toHaveBeenCalledWith('architect');
    expect(configUpdate).toHaveBeenCalledWith('agentMode', false, vscode.ConfigurationTarget.Global);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resilienceStatus',
      code: 'CODE_ENTRY_BLOCKED',
      action: 'create_plan_now'
    }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      code: 'MODE_TRANSITION_BLOCKED',
      action: 'create_plan_now'
    }));
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'modeChanged',
      modeId: 'architect'
    }));
  });

  it('emits auto-handover resilience status when approved plan is healed on code entry', async () => {
    const configUpdate = vi.fn().mockResolvedValue(undefined);
    const getConfiguration = vi.mocked(vscode.workspace.getConfiguration);
    getConfiguration.mockReturnValue({
      get: vi.fn((key: string, fallback?: unknown) => {
        if (key === 'modeStateMachineV2') return true;
        if (key === 'agentMode') return false;
        return fallback;
      }),
      update: configUpdate
    } as any);

    const postMessage = vi.fn();
    const setSelectedMode = vi.fn();

    const provider = Object.create(ChatViewProvider.prototype) as any;
    provider.modeService = {
      getCurrentMode: vi.fn(() => ({
        id: 'architect',
        displayName: 'Architect',
        description: 'Planning mode'
      })),
      setMode: vi.fn().mockResolvedValue(undefined)
    };
    provider.messageHandler = {
      setSelectedMode,
      getContext: vi.fn(() => ({
        selectedModel: 'openai/gpt-4o-mini',
        currentFlowId: 'flow-auto-handover'
      }))
    };
    provider.context = {
      globalState: {
        update: vi.fn().mockResolvedValue(undefined)
      }
    };
    provider.agentManager = {
      getPlanningManager: vi.fn(() => ({
        prepareCodeEntry: vi.fn().mockResolvedValue({
          ok: true,
          code: 'CODE_ENTRY_AUTO_HANDOVER_APPLIED',
          reason: 'Approved plan auto-handed over.',
          autoHandedOver: true,
          planId: 'plan-1',
          planStatus: 'handed_over'
        })
      }))
    };
    provider._view = {
      webview: {
        postMessage
      }
    };

    await provider.setSelectedMode('code');

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'resilienceStatus',
      code: 'CODE_ENTRY_AUTO_HANDOVER_APPLIED',
      decision: 'recover'
    }));
    expect(setSelectedMode).toHaveBeenCalledWith('code');
  });
});
