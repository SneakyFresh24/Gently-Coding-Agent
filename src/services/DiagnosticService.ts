import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export type DiagnosticSeverity = 'info' | 'warning' | 'error';

export type DiagnosticCategory =
  | 'resilience'
  | 'subagent'
  | 'approval'
  | 'plan'
  | 'handover'
  | 'unknown'
  | 'system';

export interface DiagnosticEventEnvelope {
  timestamp: string;
  severity: DiagnosticSeverity;
  code: string;
  category: DiagnosticCategory;
  flowId: string | null;
  correlationId: string;
  mode: string;
  model: string;
  source: string;
  payload: Record<string, unknown>;
}

export interface UnknownEventContract {
  kind: 'tool' | 'webview_message';
  origin: string;
  rawType: string;
  correlationId: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface UnknownEventInput {
  kind: 'tool' | 'webview_message';
  origin: string;
  rawType: string;
  correlationId?: string;
  flowId?: string | null;
  mode?: string;
  model?: string;
  payload?: Record<string, unknown>;
}

interface DiagnosticServiceOptions {
  workspaceRoot?: string;
  maxFileSizeBytes?: number;
  maxFiles?: number;
  dedupeWindowMs?: number;
  unknownSurfaceWindowMs?: number;
  snapshotSize?: number;
}

interface DedupState {
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface FlowSnapshot {
  flowId: string;
  lastCode: string;
  lastSeverity: DiagnosticSeverity;
  lastSeenAt: number;
  count: number;
}

const DEFAULT_MAX_FILE_SIZE_BYTES = 512 * 1024;
const DEFAULT_MAX_FILES = 10;
const DEFAULT_DEDUPE_WINDOW_MS = 15_000;
const DEFAULT_UNKNOWN_SURFACE_WINDOW_MS = 60_000;
const DEFAULT_SNAPSHOT_SIZE = 400;

export class DiagnosticService {
  private static instance: DiagnosticService | null = null;

  private readonly observabilityDir: string;
  private readonly errorLogDir: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxFiles: number;
  private readonly dedupeWindowMs: number;
  private readonly unknownSurfaceWindowMs: number;
  private readonly snapshotSize: number;
  private readonly dedupeCache = new Map<string, DedupState>();
  private readonly unknownEventCache = new Map<string, UnknownEventContract>();
  private readonly unknownSurfaceAt = new Map<string, number>();
  private readonly approvalRequestedAt = new Map<string, number>();
  private readonly activeFlows = new Map<string, FlowSnapshot>();
  private readonly ringBuffer: DiagnosticEventEnvelope[] = [];
  private readonly recentErrorCodes: string[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private currentFilePath: string | null = null;
  private currentFileSizeBytes = 0;
  private errorFilePath: string | null = null;
  private errorFileSizeBytes = 0;
  private outputChannel: vscode.OutputChannel | null = null;
  private systemWarningEmitter?: (message: {
    content: string;
    code: string;
    severity: DiagnosticSeverity;
    correlationId: string;
  }) => void;
  private lastPlanStatusByPlanId = new Map<string, string>();

  private constructor(options: DiagnosticServiceOptions = {}) {
    const workspaceRoot =
      options.workspaceRoot ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      '';

    const fallbackBase = workspaceRoot || path.join(process.cwd(), '.gently');
    this.observabilityDir = workspaceRoot
      ? path.join(workspaceRoot, '.gently', 'observability')
      : path.join(fallbackBase, 'observability');
    this.errorLogDir = workspaceRoot
      ? path.join(workspaceRoot, '.gently', 'error-log')
      : path.join(fallbackBase, 'error-log');
    this.maxFileSizeBytes = options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES;
    this.maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
    this.dedupeWindowMs = options.dedupeWindowMs || DEFAULT_DEDUPE_WINDOW_MS;
    this.unknownSurfaceWindowMs =
      options.unknownSurfaceWindowMs || DEFAULT_UNKNOWN_SURFACE_WINDOW_MS;
    this.snapshotSize = options.snapshotSize || DEFAULT_SNAPSHOT_SIZE;
  }

  public static initialize(options: DiagnosticServiceOptions = {}): DiagnosticService {
    if (!DiagnosticService.instance) {
      DiagnosticService.instance = new DiagnosticService(options);
    }
    return DiagnosticService.instance;
  }

  public static getInstance(): DiagnosticService | null {
    return DiagnosticService.instance;
  }

  public static resetInstanceForTests(): void {
    DiagnosticService.instance = null;
  }

  public setSystemWarningEmitter(
    emitter: (message: {
      content: string;
      code: string;
      severity: DiagnosticSeverity;
      correlationId: string;
    }) => void
  ): void {
    this.systemWarningEmitter = emitter;
  }

  public record(event: Omit<DiagnosticEventEnvelope, 'timestamp'> & { timestamp?: string }): void {
    const now = Date.now();
    const envelope: DiagnosticEventEnvelope = {
      timestamp: event.timestamp || new Date(now).toISOString(),
      severity: event.severity,
      code: event.code,
      category: event.category,
      flowId: event.flowId ?? null,
      correlationId: event.correlationId || `diag:${event.code}:${now}`,
      mode: event.mode || 'unknown',
      model: event.model || 'unknown',
      source: event.source || 'unknown',
      payload: this.toSerializablePayload(event.payload || {}),
    };

    if (this.shouldThrottle(envelope, now)) {
      return;
    }

    this.pushToBuffers(envelope, now);
    void this.enqueueWrite(envelope);
  }

  public captureOutboundMessage(message: any): void {
    if (!message || typeof message.type !== 'string') return;

    const type = String(message.type);
    const flowId =
      typeof message.flowId === 'string' && message.flowId.trim() !== ''
        ? message.flowId
        : null;
    const model =
      typeof message.model === 'string' && message.model.trim() !== ''
        ? message.model
        : 'unknown';
    const mode =
      typeof message.mode === 'string' && message.mode.trim() !== ''
        ? message.mode
        : 'unknown';

    if (type === 'queryRuntimeEvent') {
      const runtimeEvent = message.event && typeof message.event === 'object' ? message.event : null;
      const runtimeType = String(runtimeEvent?.type || 'unknown');
      const runtimeFlowId =
        typeof runtimeEvent?.flowId === 'string' && runtimeEvent.flowId.trim() !== ''
          ? runtimeEvent.flowId
          : flowId;
      if (runtimeType === 'status') {
        this.record({
          severity: this.normalizeSeverity(runtimeEvent?.severity),
          code: String(runtimeEvent?.code || 'QUERY_RUNTIME_STATUS'),
          category: 'resilience',
          flowId: runtimeFlowId,
          correlationId: String(runtimeEvent?.correlationId || this.makeCorrelationId(runtimeType, runtimeFlowId)),
          mode,
          model: String(runtimeEvent?.model || model),
          source: 'extension:webview',
          payload: runtimeEvent as Record<string, unknown>,
        });
        return;
      }
      if (runtimeType === 'result_error' || runtimeType === 'result_success') {
        const result = runtimeEvent?.result && typeof runtimeEvent.result === 'object' ? runtimeEvent.result : {};
        this.record({
          severity: runtimeType === 'result_error' ? 'warning' : 'info',
          code: String((result as Record<string, unknown>).code || `QUERY_RUNTIME_${runtimeType.toUpperCase()}`),
          category: 'resilience',
          flowId: runtimeFlowId,
          correlationId: this.makeCorrelationId(runtimeType, runtimeFlowId),
          mode,
          model,
          source: 'extension:webview',
          payload: runtimeEvent as Record<string, unknown>,
        });
        return;
      }
    }

    if (type === 'resilienceStatus') {
      this.record({
        severity: this.normalizeSeverity(message.severity),
        code: String(message.code || 'RESILIENCE_STATUS'),
        category: 'resilience',
        flowId,
        correlationId: String(message.correlationId || this.makeCorrelationId(type, flowId)),
        mode,
        model,
        source: 'extension:webview',
        payload: message as Record<string, unknown>,
      });
      return;
    }

    if (type === 'subagentStatus') {
      this.record({
        severity: this.normalizeSeverity(message.severity),
        code: String(message.code || 'SUBAGENT_STATUS'),
        category: 'subagent',
        flowId,
        correlationId: String(message.correlationId || this.makeCorrelationId(type, flowId)),
        mode,
        model,
        source: 'extension:webview',
        payload: message as Record<string, unknown>,
      });
      return;
    }

    if (type === 'toolApprovalRequest') {
      const approvalId = String(message.approvalId || '');
      if (approvalId) {
        this.approvalRequestedAt.set(approvalId, Number(message.timestamp || Date.now()));
      }
      this.record({
        severity: 'info',
        code: 'APPROVAL_REQUESTED',
        category: 'approval',
        flowId,
        correlationId: approvalId ? `approval:${approvalId}` : this.makeCorrelationId(type, flowId),
        mode,
        model,
        source: 'extension:webview',
        payload: message as Record<string, unknown>,
      });
      return;
    }

    if (type === 'toolApprovalResolved') {
      const approvalId = String(message.approvalId || '');
      const startedAt = approvalId ? this.approvalRequestedAt.get(approvalId) : undefined;
      const resolvedAt = Number(message.timestamp || Date.now());
      if (approvalId) this.approvalRequestedAt.delete(approvalId);
      const durationMs =
        typeof startedAt === 'number' && Number.isFinite(startedAt)
          ? Math.max(0, resolvedAt - startedAt)
          : undefined;
      const status = String(message.status || 'resolved');
      const severity: DiagnosticSeverity =
        status === 'timeout' ? 'warning' : status === 'rejected' ? 'warning' : 'info';
      this.record({
        severity,
        code: `APPROVAL_RESOLVED_${status.toUpperCase()}`,
        category: 'approval',
        flowId,
        correlationId: approvalId ? `approval:${approvalId}` : this.makeCorrelationId(type, flowId),
        mode,
        model,
        source: 'extension:webview',
        payload: {
          ...(message as Record<string, unknown>),
          durationMs,
        },
      });
      return;
    }

    if (type === 'planCardCreated' || type === 'planCardUpdated' || type === 'planStatusUpdate') {
      const planId =
        String(
          message?.plan?.id ||
            message?.planId ||
            message?.currentPlanId ||
            ''
        ) || '';
      const nextStatus =
        String(message?.plan?.status || message?.status || '').trim() || 'unknown';
      if (planId) {
        const previous = this.lastPlanStatusByPlanId.get(planId) || 'unknown';
        this.lastPlanStatusByPlanId.set(planId, nextStatus);
        this.record({
          severity: 'info',
          code: 'PLAN_STATE_TRANSITION',
          category: 'plan',
          flowId,
          correlationId: `plan:${planId}:${nextStatus}`,
          mode,
          model,
          source: 'extension:webview',
          payload: {
            planId,
            from: previous,
            to: nextStatus,
            cause: type,
          },
        });
      }
      return;
    }

    if (type === 'planApprovalRequested' || type === 'planApprovalResolved') {
      const planId = String(message.planId || '');
      const code = type === 'planApprovalRequested' ? 'PLAN_APPROVAL_REQUESTED' : 'PLAN_APPROVAL_RESOLVED';
      this.record({
        severity: type === 'planApprovalRequested' ? 'info' : 'warning',
        code,
        category: 'plan',
        flowId,
        correlationId: planId ? `plan:${planId}:approval` : this.makeCorrelationId(type, flowId),
        mode,
        model,
        source: 'extension:webview',
        payload: message as Record<string, unknown>,
      });
      return;
    }

    if (type === 'handoverProgress') {
      const status = String(message.status || 'unknown').toUpperCase();
      const severity: DiagnosticSeverity =
        status === 'ABORTED' ? 'error' : status === 'COMPLETED' ? 'info' : 'info';
      this.record({
        severity,
        code: `HANDOVER_${status}`,
        category: 'handover',
        flowId,
        correlationId: this.makeCorrelationId(`handover:${status}`, flowId),
        mode,
        model,
        source: 'extension:webview',
        payload: message as Record<string, unknown>,
      });
      return;
    }
  }

  public recordUnknownEvent(input: UnknownEventInput): UnknownEventContract {
    const now = Date.now();
    const correlationId =
      input.correlationId && input.correlationId.trim() !== ''
        ? input.correlationId
        : `unknown:${input.kind}:${input.rawType}:${now}`;
    const key = `${input.kind}:${input.origin}:${input.rawType}:${correlationId}`;
    const existing = this.unknownEventCache.get(key);
    const contract: UnknownEventContract = existing
      ? {
          ...existing,
          count: existing.count + 1,
          lastSeenAt: now,
        }
      : {
          kind: input.kind,
          origin: input.origin,
          rawType: input.rawType,
          correlationId,
          count: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        };
    this.unknownEventCache.set(key, contract);

    const code = input.kind === 'tool' ? 'UNKNOWN_TOOL' : 'UNKNOWN_WEBVIEW_MESSAGE';
    this.record({
      severity: 'warning',
      code,
      category: 'unknown',
      flowId: typeof input.flowId === 'string' ? input.flowId : null,
      correlationId,
      mode:
        typeof input.mode === 'string' && input.mode.trim().length > 0
          ? input.mode
          : 'unknown',
      model:
        typeof input.model === 'string' && input.model.trim().length > 0
          ? input.model
          : 'unknown',
      source: input.origin,
      payload: {
        kind: input.kind,
        rawType: input.rawType,
        count: contract.count,
        firstSeenAt: contract.firstSeenAt,
        lastSeenAt: contract.lastSeenAt,
        ...(input.payload || {}),
      },
    });

    const lastSurfaceAt = this.unknownSurfaceAt.get(key) || 0;
    if (now - lastSurfaceAt >= this.unknownSurfaceWindowMs) {
      this.unknownSurfaceAt.set(key, now);
      this.emitSystemWarning({
        content: `[Warning:${code}] ${input.rawType} (${input.origin}) [correlationId=${correlationId}]`,
        code,
        severity: 'warning',
        correlationId,
      });
    }

    return contract;
  }

  public getSnapshot(limit = 120): {
    generatedAt: string;
    eventCount: number;
    events: DiagnosticEventEnvelope[];
    activeFlows: FlowSnapshot[];
    recentErrorCodes: string[];
    unknownEvents: UnknownEventContract[];
  } {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 120;
    const events = this.ringBuffer.slice(-safeLimit);
    const activeFlows = Array.from(this.activeFlows.values()).sort(
      (a, b) => b.lastSeenAt - a.lastSeenAt
    );
    return {
      generatedAt: new Date().toISOString(),
      eventCount: this.ringBuffer.length,
      events,
      activeFlows,
      recentErrorCodes: [...this.recentErrorCodes],
      unknownEvents: Array.from(this.unknownEventCache.values()).sort(
        (a, b) => b.lastSeenAt - a.lastSeenAt
      ),
    };
  }

  public resetBuffers(): void {
    this.dedupeCache.clear();
    this.unknownEventCache.clear();
    this.unknownSurfaceAt.clear();
    this.approvalRequestedAt.clear();
    this.activeFlows.clear();
    this.ringBuffer.length = 0;
    this.recentErrorCodes.length = 0;
    this.lastPlanStatusByPlanId.clear();
  }

  public async flush(): Promise<void> {
    await this.writeQueue;
  }

  private normalizeSeverity(value: unknown): DiagnosticSeverity {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'error') return 'error';
    if (normalized === 'warning' || normalized === 'warn') return 'warning';
    return 'info';
  }

  private shouldThrottle(event: DiagnosticEventEnvelope, now: number): boolean {
    if (event.severity === 'info') return false;
    const key = `${event.code}:${event.correlationId}`;
    const state = this.dedupeCache.get(key);
    if (!state) {
      this.dedupeCache.set(key, { count: 1, firstSeenAt: now, lastSeenAt: now });
      return false;
    }
    if (now - state.lastSeenAt < this.dedupeWindowMs) {
      this.dedupeCache.set(key, {
        ...state,
        count: state.count + 1,
        lastSeenAt: now,
      });
      return true;
    }
    this.dedupeCache.set(key, {
      ...state,
      count: state.count + 1,
      lastSeenAt: now,
    });
    return false;
  }

  private pushToBuffers(event: DiagnosticEventEnvelope, now: number): void {
    this.ringBuffer.push(event);
    while (this.ringBuffer.length > this.snapshotSize) {
      this.ringBuffer.shift();
    }

    if (event.severity === 'error') {
      this.recentErrorCodes.push(event.code);
      while (this.recentErrorCodes.length > 40) this.recentErrorCodes.shift();
    }

    if (event.flowId) {
      const flow = this.activeFlows.get(event.flowId);
      if (!flow) {
        this.activeFlows.set(event.flowId, {
          flowId: event.flowId,
          lastCode: event.code,
          lastSeverity: event.severity,
          lastSeenAt: now,
          count: 1,
        });
      } else {
        this.activeFlows.set(event.flowId, {
          ...flow,
          lastCode: event.code,
          lastSeverity: event.severity,
          lastSeenAt: now,
          count: flow.count + 1,
        });
      }
    }
  }

  private async enqueueWrite(event: DiagnosticEventEnvelope): Promise<void> {
    const line = JSON.stringify(event);
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.appendLineToStream(line, false);
        if (event.severity !== 'info') {
          await this.appendLineToStream(line, true);
        }
      })
      .catch((error) => {
        this.logFallback(`Diagnostic write failed: ${error instanceof Error ? error.message : String(error)} | ${line}`);
      });
    await this.writeQueue;
  }

  private async appendLineToStream(line: string, errorStream: boolean): Promise<void> {
    const dir = errorStream ? this.errorLogDir : this.observabilityDir;
    await fs.mkdir(dir, { recursive: true });
    await this.ensureWritableFile(errorStream);
    const bytes = Buffer.byteLength(`${line}\n`, 'utf8');
    const currentFilePath = errorStream ? this.errorFilePath : this.currentFilePath;
    const currentFileSizeBytes = errorStream ? this.errorFileSizeBytes : this.currentFileSizeBytes;
    if (!currentFilePath || currentFileSizeBytes + bytes > this.maxFileSizeBytes) {
      await this.rotateFile(errorStream);
    }
    const nextFilePath = errorStream ? this.errorFilePath : this.currentFilePath;
    if (!nextFilePath) {
      throw new Error('No diagnostic log file available after rotation.');
    }
    await fs.appendFile(nextFilePath, `${line}\n`, 'utf8');
    if (errorStream) {
      this.errorFileSizeBytes += bytes;
    } else {
      this.currentFileSizeBytes += bytes;
    }
  }

  private async ensureWritableFile(errorStream: boolean): Promise<void> {
    const currentFilePath = errorStream ? this.errorFilePath : this.currentFilePath;
    if (currentFilePath) return;
    await this.rotateFile(errorStream);
  }

  private async rotateFile(errorStream: boolean): Promise<void> {
    const nonce = Math.random().toString(36).slice(2, 8);
    const prefix = errorStream ? 'errors' : 'events';
    const targetDir = errorStream ? this.errorLogDir : this.observabilityDir;
    const fileName = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${nonce}.jsonl`;
    const absolutePath = path.join(targetDir, fileName);
    if (errorStream) {
      this.errorFilePath = absolutePath;
      this.errorFileSizeBytes = 0;
    } else {
      this.currentFilePath = absolutePath;
      this.currentFileSizeBytes = 0;
    }
    await fs.writeFile(absolutePath, '', 'utf8');
    await this.cleanupOldFiles(targetDir);
  }

  private async cleanupOldFiles(targetDir: string): Promise<void> {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name);

    if (files.length <= this.maxFiles) return;

    const filesWithStats = await Promise.all(
      files.map(async (name) => {
        const absolutePath = path.join(targetDir, name);
        const stats = await fs.stat(absolutePath);
        return { absolutePath, mtimeMs: stats.mtimeMs };
      })
    );
    filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const stale = filesWithStats.slice(this.maxFiles);
    await Promise.all(
      stale.map(async (entry) => {
        try {
          await fs.unlink(entry.absolutePath);
        } catch (error) {
          this.logFallback(
            `Failed to remove stale diagnostic file ${entry.absolutePath}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      })
    );
  }

  private toSerializablePayload(payload: Record<string, unknown>): Record<string, unknown> {
    try {
      return JSON.parse(
        JSON.stringify(payload, (_key, value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          return value;
        })
      ) as Record<string, unknown>;
    } catch {
      return { message: '[unserializable_payload]' };
    }
  }

  private emitSystemWarning(message: {
    content: string;
    code: string;
    severity: DiagnosticSeverity;
    correlationId: string;
  }): void {
    if (!this.systemWarningEmitter) return;
    try {
      this.systemWarningEmitter(message);
    } catch (error) {
      this.logFallback(
        `Failed to emit system warning (${message.code}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private makeCorrelationId(type: string, flowId: string | null): string {
    return `${flowId || 'flow-unknown'}:${type}:${Date.now()}`;
  }

  private logFallback(message: string): void {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('Gently Diagnostics');
    }
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}
