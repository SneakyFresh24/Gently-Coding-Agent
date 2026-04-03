import * as fs from 'fs';
import * as path from 'path';

export interface R4SuiteReport {
  suite: string;
  totalFlows: number;
  silentAborts: number;
  stuckStates: number;
  terminalCoverage: number;
  recoveryRate: number;
  replayMismatchCount: number;
  replayDeterministic: boolean;
  pass: boolean;
}

export interface R4SuiteMetricsInput {
  suite: string;
  totalFlows: number;
  silentAborts: number;
  stuckStates: number;
  terminalFailures: number;
  terminalFailuresWithCodeAndAction: number;
  retryableRecoveryTotal: number;
  retryableRecoverySucceeded: number;
  replayMismatchCount: number;
}

export interface R4SloThresholds {
  terminalCoverageMin: number;
  recoveryRateMin: number;
}

export const R4_DEFAULT_THRESHOLDS: R4SloThresholds = {
  terminalCoverageMin: 0.999,
  recoveryRateMin: 0.95
};

const VOLATILE_KEYS = new Set([
  'timestamp',
  'ts',
  'time',
  'durationMs',
  'duration_ms',
  'flowId',
  'correlationId',
  'subagentId'
]);

export function createDeterministicFaultPlan(totalFlows: number, faultCatalog: string[], seed: number): string[] {
  if (!Number.isFinite(totalFlows) || totalFlows < 1) {
    throw new Error(`Invalid totalFlows: ${totalFlows}`);
  }
  if (!Array.isArray(faultCatalog) || faultCatalog.length === 0) {
    throw new Error('Fault catalog must contain at least one scenario.');
  }

  const plan: string[] = [];
  for (let i = 0; i < totalFlows; i += 1) {
    plan.push(faultCatalog[i % faultCatalog.length]);
  }

  const rand = createSeededRandom(seed);
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = plan[i];
    plan[i] = plan[j];
    plan[j] = tmp;
  }

  return plan;
}

export function normalizeReplaySnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeReplaySnapshot(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const sortedKeys = Object.keys(input).sort();
  for (const key of sortedKeys) {
    if (VOLATILE_KEYS.has(key)) {
      continue;
    }
    output[key] = normalizeReplaySnapshot(input[key]);
  }
  return output;
}

export function countReplayMismatches(first: unknown[], second: unknown[]): number {
  if (first.length !== second.length) {
    return Math.max(first.length, second.length);
  }

  let mismatches = 0;
  for (let i = 0; i < first.length; i += 1) {
    const left = JSON.stringify(normalizeReplaySnapshot(first[i]));
    const right = JSON.stringify(normalizeReplaySnapshot(second[i]));
    if (left !== right) {
      mismatches += 1;
    }
  }
  return mismatches;
}

export function buildR4SuiteReport(
  input: R4SuiteMetricsInput,
  thresholds: R4SloThresholds = R4_DEFAULT_THRESHOLDS
): R4SuiteReport {
  const terminalCoverage = input.terminalFailures === 0
    ? 1
    : input.terminalFailuresWithCodeAndAction / input.terminalFailures;
  const recoveryRate = input.retryableRecoveryTotal === 0
    ? 1
    : input.retryableRecoverySucceeded / input.retryableRecoveryTotal;
  const replayDeterministic = input.replayMismatchCount === 0;

  const pass = input.silentAborts === 0
    && input.stuckStates === 0
    && terminalCoverage >= thresholds.terminalCoverageMin
    && recoveryRate >= thresholds.recoveryRateMin
    && replayDeterministic;

  return {
    suite: input.suite,
    totalFlows: input.totalFlows,
    silentAborts: input.silentAborts,
    stuckStates: input.stuckStates,
    terminalCoverage,
    recoveryRate,
    replayMismatchCount: input.replayMismatchCount,
    replayDeterministic,
    pass
  };
}

export function writeR4SuiteReport(report: R4SuiteReport, reportPath?: string): void {
  const target = reportPath || process.env.GENTLY_R4_REPORT_FILE;
  if (!target) return;

  const absolutePath = path.resolve(target);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(report, null, 2), 'utf8');
}

function createSeededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x12345678;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
