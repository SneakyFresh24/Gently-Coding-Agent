import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DiagnosticService } from './DiagnosticService';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [] },
  window: {
    createOutputChannel: () => ({
      appendLine: vi.fn()
    })
  }
}));

describe('DiagnosticService', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    DiagnosticService.resetInstanceForTests();
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gently-diagnostics-'));
  });

  afterEach(async () => {
    DiagnosticService.resetInstanceForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('records envelopes and persists jsonl logs', async () => {
    const diagnostics = DiagnosticService.initialize({
      workspaceRoot,
      maxFileSizeBytes: 4096,
      maxFiles: 3
    });

    diagnostics.record({
      severity: 'info',
      code: 'TEST_EVENT',
      category: 'system',
      flowId: 'flow-test',
      correlationId: 'flow-test:TEST_EVENT:1',
      mode: 'architect',
      model: 'test-model',
      source: 'unit-test',
      payload: { ok: true }
    });
    await diagnostics.flush();

    const snapshot = diagnostics.getSnapshot(10);
    expect(snapshot.events.length).toBe(1);
    expect(snapshot.events[0].code).toBe('TEST_EVENT');

    const logDir = path.join(workspaceRoot, '.gently', 'observability');
    const files = await fs.readdir(logDir);
    expect(files.some((name) => name.endsWith('.jsonl'))).toBe(true);
  });

  it('dedupes repetitive warnings for identical code+correlation', async () => {
    const diagnostics = DiagnosticService.initialize({ workspaceRoot });
    for (let i = 0; i < 3; i += 1) {
      diagnostics.record({
        severity: 'warning',
        code: 'DUP_WARNING',
        category: 'unknown',
        flowId: null,
        correlationId: 'dup:1',
        mode: 'unknown',
        model: 'unknown',
        source: 'unit-test',
        payload: { i }
      });
    }
    await diagnostics.flush();

    const warnings = diagnostics
      .getSnapshot(50)
      .events.filter((event) => event.code === 'DUP_WARNING');
    expect(warnings.length).toBe(1);
  });

  it('tracks unknown events with count and surfaces warning only once per window', async () => {
    const diagnostics = DiagnosticService.initialize({ workspaceRoot });
    const emitter = vi.fn();
    diagnostics.setSystemWarningEmitter(emitter);

    diagnostics.recordUnknownEvent({
      kind: 'webview_message',
      origin: 'webview_message_handler',
      rawType: 'mysteryType',
      correlationId: 'unknown:webview_message:mysteryType'
    });
    diagnostics.recordUnknownEvent({
      kind: 'webview_message',
      origin: 'webview_message_handler',
      rawType: 'mysteryType',
      correlationId: 'unknown:webview_message:mysteryType'
    });
    await diagnostics.flush();

    const snapshot = diagnostics.getSnapshot(20);
    const unknown = snapshot.unknownEvents.find((entry) => entry.rawType === 'mysteryType');
    expect(unknown?.count).toBe(2);
    expect(emitter).toHaveBeenCalledTimes(1);
  });

  it('writes warning/error events to dedicated error-log stream', async () => {
    const diagnostics = DiagnosticService.initialize({
      workspaceRoot,
      maxFileSizeBytes: 4096,
      maxFiles: 3
    });

    diagnostics.record({
      severity: 'info',
      code: 'INFO_ONLY',
      category: 'system',
      flowId: null,
      correlationId: 'info:1',
      mode: 'architect',
      model: 'test-model',
      source: 'unit-test',
      payload: { ok: true }
    });
    diagnostics.record({
      severity: 'warning',
      code: 'WARN_EVENT',
      category: 'unknown',
      flowId: null,
      correlationId: 'warn:1',
      mode: 'architect',
      model: 'test-model',
      source: 'unit-test',
      payload: { warning: true }
    });
    await diagnostics.flush();

    const errorLogDir = path.join(workspaceRoot, '.gently', 'error-log');
    const files = await fs.readdir(errorLogDir);
    expect(files.some((name) => name.endsWith('.jsonl'))).toBe(true);
  });

  it('rotates and retains only configured number of files', async () => {
    const diagnostics = DiagnosticService.initialize({
      workspaceRoot,
      maxFileSizeBytes: 220,
      maxFiles: 2
    });

    for (let i = 0; i < 40; i += 1) {
      diagnostics.record({
        severity: 'info',
        code: `ROTATE_${i}`,
        category: 'system',
        flowId: null,
        correlationId: `rotate:${i}`,
        mode: 'unknown',
        model: 'unknown',
        source: 'unit-test',
        payload: {
          text: `event-${i}-${'x'.repeat(40)}`
        }
      });
    }

    await diagnostics.flush();

    const logDir = path.join(workspaceRoot, '.gently', 'observability');
    const files = (await fs.readdir(logDir)).filter((name) => name.endsWith('.jsonl'));
    expect(files.length).toBeLessThanOrEqual(2);
  });
});
