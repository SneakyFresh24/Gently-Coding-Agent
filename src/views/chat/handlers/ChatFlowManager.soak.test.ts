import { describe, expect, it, vi } from 'vitest';
import { ChatFlowManager } from './ChatFlowManager';
import { ChatViewContext } from '../types/ChatTypes';
import { OpenRouterHttpError } from '../../../services/OpenRouterService';
import {
  buildR4SuiteReport,
  countReplayMismatches,
  createDeterministicFaultPlan,
  normalizeReplaySnapshot,
  writeR4SuiteReport
} from '../../../core/resilience/R4SoakHarness';

let configOverrides: Record<string, unknown> = {};

vi.mock('vscode', () => ({
  workspace: {
    name: 'soak-workspace',
    getConfiguration: vi.fn(() => ({
      get: (key: string, fallback: unknown) => (key in configOverrides ? configOverrides[key] : fallback)
    }))
  }
}));

vi.mock('../../../services/LogService', () => ({
  LogService: class {
    info(): void {}
    warn(): void {}
    error(): void {}
    event(): void {}
  }
}));

const TOTAL_FLOWS = 1000;
const CHAT_FAULT_SEED = 41031;
const CHAT_FAULT_CATALOG = [
  'baseline_success',
  'rate_limit_429',
  'empty_response_recover',
  'sequence_recover',
  'stream_cut_terminal',
  'context_overflow_recover',
  'context_overflow_terminal',
  'mixed_fault_chain'
] as const;

type ChatFaultScenario = typeof CHAT_FAULT_CATALOG[number];

const successResponse = {
  assistantMessage: 'ok',
  toolCalls: [],
  incompleteToolCalls: [],
  usage: undefined,
  streamTerminated: true
};

function createContext(selectedModel: string = 'openai/gpt-4o-mini'): ChatViewContext {
  return {
    agentMode: false,
    selectedModel,
    selectedMode: 'code',
    conversationHistory: [
      {
        id: 'u1',
        role: 'user',
        content: 'Please help',
        timestamp: 1700000000000
      }
    ],
    shouldStopStream: false,
    messageCheckpoints: new Map(),
    toolExecutionStartSent: new Set(),
    sequenceRepairHistory: [],
    consecutiveMistakeCount: 0,
    recentToolCallFingerprints: [],
    doomLoopAllowedTools: new Set<string>(),
    loopDetectorState: { count: 0 },
    recentModeSwitches: [],
    isToolExecutionActive: false
  };
}

function createManager() {
  const sendMessageToWebview = vi.fn();
  const streamResponse = vi.fn();
  const openRouterService = {
    getMaxTokens: vi.fn().mockResolvedValue(8000),
    getContextLength: vi.fn().mockResolvedValue(32000),
    isRateLimitError: vi.fn().mockReturnValue(false),
    isGuardrailPrivacyError: vi.fn().mockReturnValue(false),
    isToolCallSequenceError: vi.fn().mockReturnValue(false),
    isContextLengthError: vi.fn().mockReturnValue(false),
    getModelPricing: vi.fn().mockResolvedValue(null)
  };
  const toolCallManager = {
    repairConversationHistory: vi.fn((messages: any[]) => ({
      repaired: false,
      fixes: [],
      issuesBefore: [],
      issuesAfter: [],
      messages
    })),
    validateConversationHistory: vi.fn().mockReturnValue({ valid: true, errors: [] })
  };

  const manager = new ChatFlowManager(
    { getFormattedTools: vi.fn().mockReturnValue([]) } as any,
    {
      saveMessageToHistory: vi.fn(),
      getActiveSession: vi.fn().mockResolvedValue(null),
      getChatProvider: vi.fn().mockReturnValue(null)
    } as any,
    {} as any,
    { prepareSystemPrompt: vi.fn().mockResolvedValue('system prompt') } as any,
    { streamResponse } as any,
    {} as any,
    toolCallManager as any,
    { handleToolCalls: vi.fn() } as any,
    { getTemperature: vi.fn().mockReturnValue(0.7), getCurrentMode: vi.fn().mockReturnValue(null) } as any,
    sendMessageToWebview,
    openRouterService as any
  );

  (manager as any).sleepWithStop = vi.fn().mockResolvedValue(undefined);
  const tokenBudgetManager = (manager as any).tokenBudgetManager;
  tokenBudgetManager.estimateInputTokens = vi.fn().mockReturnValue(64);
  tokenBudgetManager.compressMessagesForBudget = vi.fn().mockImplementation(
    (_model: string, messages: any[]) => ({
      messages,
      inputTokens: 64,
      droppedMessages: 0,
      wasCompressed: false,
      summaryInserted: false
    })
  );
  tokenBudgetManager.pruneToolOutputsForContext = vi.fn().mockImplementation(
    (_model: string, messages: any[]) => ({
      messages,
      prunedMessages: 0
    })
  );

  return { manager, sendMessageToWebview, streamResponse, openRouterService };
}

function configureScenario(
  scenario: ChatFaultScenario,
  manager: ChatFlowManager,
  streamResponse: ReturnType<typeof vi.fn>,
  openRouterService: any
): { retryable: boolean; expectStreamCutCode: boolean; expectContextCode: boolean } {
  switch (scenario) {
    case 'baseline_success':
      streamResponse.mockResolvedValueOnce(successResponse);
      return { retryable: false, expectStreamCutCode: false, expectContextCode: false };

    case 'rate_limit_429': {
      const rateLimitError = new OpenRouterHttpError({
        status: 429,
        message: 'rate limited',
        retryAfterMs: 100
      });
      openRouterService.isRateLimitError.mockImplementation((error: unknown) => error === rateLimitError);
      streamResponse.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce(successResponse);
      return { retryable: true, expectStreamCutCode: false, expectContextCode: false };
    }

    case 'empty_response_recover':
      streamResponse
        .mockResolvedValueOnce({
          assistantMessage: '',
          toolCalls: [],
          incompleteToolCalls: [],
          usage: undefined,
          streamTerminated: true
        })
        .mockResolvedValueOnce(successResponse);
      return { retryable: true, expectStreamCutCode: false, expectContextCode: false };

    case 'sequence_recover': {
      const sequenceError = new Error('tool call result does not follow tool call');
      openRouterService.isToolCallSequenceError.mockImplementation((error: unknown) => error === sequenceError);
      streamResponse.mockRejectedValueOnce(sequenceError).mockResolvedValueOnce(successResponse);
      return { retryable: false, expectStreamCutCode: false, expectContextCode: false };
    }

    case 'stream_cut_terminal':
      streamResponse.mockResolvedValueOnce({
        assistantMessage: 'partial',
        toolCalls: [],
        incompleteToolCalls: [],
        usage: undefined,
        streamTerminated: false
      });
      return { retryable: false, expectStreamCutCode: true, expectContextCode: false };

    case 'context_overflow_recover': {
      const contextError = new OpenRouterHttpError({
        status: 400,
        message: 'Input token count exceeds model limit'
      });
      openRouterService.isContextLengthError.mockImplementation((error: unknown) => error === contextError);
      let step = 0;
      (manager as any).runContextRecoveryStep = vi.fn().mockImplementation((params: any) => {
        step += 1;
        return {
          progressed: true,
          changed: true,
          reason: 'max_tokens_reduce',
          rawMessages: params.rawMessages,
          compression: params.compression,
          messages: params.messages,
          maxTokens: Math.max(1, params.maxTokens - 256),
          compressionLevel: params.compressionLevel,
          inputBudget: params.inputBudget,
          signature: `context-recover-step-${step}`
        };
      });
      streamResponse.mockRejectedValueOnce(contextError).mockResolvedValueOnce(successResponse);
      return { retryable: true, expectStreamCutCode: false, expectContextCode: false };
    }

    case 'context_overflow_terminal': {
      const contextError = new OpenRouterHttpError({
        status: 400,
        message: 'Input token count exceeds model limit'
      });
      openRouterService.isContextLengthError.mockImplementation((error: unknown) => error === contextError);
      (manager as any).runContextRecoveryStep = vi.fn().mockImplementation((params: any) => ({
        progressed: false,
        changed: false,
        reason: 'no_change',
        rawMessages: params.rawMessages,
        compression: params.compression,
        messages: params.messages,
        maxTokens: params.maxTokens,
        compressionLevel: params.compressionLevel,
        inputBudget: params.inputBudget,
        signature: `context-nochange-${params.maxTokens}`
      }));
      streamResponse.mockRejectedValue(contextError);
      return { retryable: false, expectStreamCutCode: false, expectContextCode: true };
    }

    case 'mixed_fault_chain': {
      const rateLimitError = new OpenRouterHttpError({
        status: 429,
        message: 'rate limited',
        retryAfterMs: 100
      });
      const contextError = new OpenRouterHttpError({
        status: 400,
        message: 'Input token count exceeds model limit'
      });
      openRouterService.isRateLimitError.mockImplementation((error: unknown) => error === rateLimitError);
      openRouterService.isContextLengthError.mockImplementation((error: unknown) => error === contextError);
      let step = 0;
      (manager as any).runContextRecoveryStep = vi.fn().mockImplementation((params: any) => {
        step += 1;
        return {
          progressed: true,
          changed: true,
          reason: 'max_tokens_reduce',
          rawMessages: params.rawMessages,
          compression: params.compression,
          messages: params.messages,
          maxTokens: Math.max(1, params.maxTokens - 512),
          compressionLevel: params.compressionLevel,
          inputBudget: params.inputBudget,
          signature: `mixed-chain-step-${step}`
        };
      });
      streamResponse
        .mockRejectedValueOnce(rateLimitError)
        .mockRejectedValueOnce(contextError)
        .mockResolvedValueOnce(successResponse);
      return { retryable: true, expectStreamCutCode: false, expectContextCode: false };
    }
  }
}

function getTerminalStatus(events: any[]): { code: string | null; action: string | null } {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if ((event?.type === 'resilienceStatus' || event?.type === 'error') && typeof event?.code === 'string') {
      return {
        code: event.code,
        action: typeof event.action === 'string' ? event.action : null
      };
    }
  }
  return { code: null, action: null };
}

function hasStuckBusyState(events: any[]): boolean {
  let generatingActive = false;
  let processingActive = false;
  for (const event of events) {
    if (event?.type === 'generatingStart') {
      generatingActive = true;
    } else if (event?.type === 'generatingEnd') {
      generatingActive = false;
    } else if (event?.type === 'processingStart') {
      processingActive = true;
    } else if (event?.type === 'processingEnd') {
      processingActive = false;
    }
  }
  return generatingActive || processingActive;
}

async function runPass(faultPlan: ChatFaultScenario[]) {
  let silentAborts = 0;
  let stuckStates = 0;
  let terminalFailures = 0;
  let terminalFailuresWithCodeAndAction = 0;
  let retryableRecoveryTotal = 0;
  let retryableRecoverySucceeded = 0;
  let streamCutClassified = 0;
  let contextOverflowClassified = 0;
  const outcomes: unknown[] = [];

  for (let i = 0; i < faultPlan.length; i += 1) {
    const scenario = faultPlan[i];
    const context = createContext();
    const { manager, sendMessageToWebview, streamResponse, openRouterService } = createManager();
    const setup = configureScenario(scenario, manager, streamResponse, openRouterService);

    if (setup.retryable) {
      retryableRecoveryTotal += 1;
    }

    let resolved = false;
    try {
      await manager.generateAndStreamResponse(context, `msg-${i}`);
      resolved = true;
    } catch {
      resolved = false;
    }

    const events = sendMessageToWebview.mock.calls.map((call) => call[0] as any);
    const stuck = resolved && hasStuckBusyState(events);
    if (stuck) {
      stuckStates += 1;
    }

    const terminal = getTerminalStatus(events);
    if (!resolved) {
      terminalFailures += 1;
      if (terminal.code && terminal.action) {
        terminalFailuresWithCodeAndAction += 1;
      } else {
        silentAborts += 1;
      }
    }

    if (setup.expectStreamCutCode && terminal.code === 'STREAM_CONTRACT_MISSING_STOP') {
      streamCutClassified += 1;
    }
    if (
      setup.expectContextCode
      && (terminal.code === 'CTX_RECOVERY_EXHAUSTED' || terminal.code === 'CTX_BUDGET_UNSAFE')
    ) {
      contextOverflowClassified += 1;
    }

    if (setup.retryable && resolved) {
      retryableRecoverySucceeded += 1;
    }

    outcomes.push(normalizeReplaySnapshot({
      scenario,
      resolved,
      stuck,
      terminalCode: terminal.code,
      terminalAction: terminal.action
    }));
  }

  return {
    totalFlows: faultPlan.length,
    silentAborts,
    stuckStates,
    terminalFailures,
    terminalFailuresWithCodeAndAction,
    retryableRecoveryTotal,
    retryableRecoverySucceeded,
    streamCutClassified,
    contextOverflowClassified,
    outcomes
  };
}

describe('ChatFlowManager R4 hardening soak gate', () => {
  it('enforces R4 SLOs with deterministic chaos replay over 1000 flows', async () => {
    configOverrides = {
      'resilience.strictResponseGuards': true,
      'resilience.contextRecoveryV2': true,
      'resilience.killSwitch': false,
      'resilience.errorContractV1': true,
      'resilience.retryOrchestratorV1': true,
      'resilience.telemetryV1': false
    };

    const faultPlan = createDeterministicFaultPlan(TOTAL_FLOWS, [...CHAT_FAULT_CATALOG], CHAT_FAULT_SEED) as ChatFaultScenario[];
    const firstRun = await runPass(faultPlan);
    const replayRun = await runPass(faultPlan);
    const replayMismatchCount = countReplayMismatches(firstRun.outcomes, replayRun.outcomes);

    const report = buildR4SuiteReport({
      suite: 'chat',
      totalFlows: firstRun.totalFlows,
      silentAborts: firstRun.silentAborts,
      stuckStates: firstRun.stuckStates,
      terminalFailures: firstRun.terminalFailures,
      terminalFailuresWithCodeAndAction: firstRun.terminalFailuresWithCodeAndAction,
      retryableRecoveryTotal: firstRun.retryableRecoveryTotal,
      retryableRecoverySucceeded: firstRun.retryableRecoverySucceeded,
      replayMismatchCount
    });
    writeR4SuiteReport(report);

    const expectedStreamCutFlows = faultPlan.filter((scenario) => scenario === 'stream_cut_terminal').length;
    const expectedContextTerminalFlows = faultPlan.filter((scenario) => scenario === 'context_overflow_terminal').length;

    expect(firstRun.streamCutClassified).toBe(expectedStreamCutFlows);
    expect(firstRun.contextOverflowClassified).toBe(expectedContextTerminalFlows);
    expect(report.silentAborts).toBe(0);
    expect(report.stuckStates).toBe(0);
    expect(report.terminalCoverage).toBeGreaterThanOrEqual(0.999);
    expect(report.recoveryRate).toBeGreaterThanOrEqual(0.95);
    expect(report.replayMismatchCount).toBe(0);
    expect(report.pass).toBe(true);
  }, 90_000);
});
