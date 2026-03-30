type AttributeMap = Record<string, string | number | boolean | undefined>;

export interface TelemetrySpan {
  addEvent(name: string, attributes?: AttributeMap): void;
  recordException(error: unknown): void;
  setAttributes(attributes: AttributeMap): void;
  setStatusError(message?: string): void;
  end(): void;
}

class NoopSpan implements TelemetrySpan {
  addEvent(_name: string, _attributes?: AttributeMap): void { }
  recordException(_error: unknown): void { }
  setAttributes(_attributes: AttributeMap): void { }
  setStatusError(_message?: string): void { }
  end(): void { }
}

export class TelemetryService {
  private static instance: TelemetryService;
  private tracer: any;
  private contextApi: any;
  private traceApi: any;
  private spanStatusCode: any;
  private readonly noopSpan = new NoopSpan();

  private constructor() {
    this.initializeOtelApi();
  }

  static getInstance(): TelemetryService {
    if (!TelemetryService.instance) {
      TelemetryService.instance = new TelemetryService();
    }
    return TelemetryService.instance;
  }

  private initializeOtelApi(): void {
    try {
      const req = Function('return require')();
      const otelApi = req('@opentelemetry/api');
      this.contextApi = otelApi.context;
      this.traceApi = otelApi.trace;
      this.spanStatusCode = otelApi.SpanStatusCode;
      this.tracer = this.traceApi.getTracer('gently-extension', '1.0.0');
    } catch {
      this.tracer = undefined;
      this.contextApi = undefined;
      this.traceApi = undefined;
      this.spanStatusCode = undefined;
    }
  }

  isEnabled(): boolean {
    return Boolean(this.tracer && this.contextApi && this.traceApi);
  }

  startSpan(name: string, attributes?: AttributeMap): TelemetrySpan {
    if (!this.isEnabled()) return this.noopSpan;
    const span = this.tracer.startSpan(name);
    if (attributes && Object.keys(attributes).length > 0) {
      span.setAttributes(attributes);
    }

    return {
      addEvent: (eventName: string, eventAttributes?: AttributeMap) => {
        span.addEvent(eventName, eventAttributes || {});
      },
      recordException: (error: unknown) => {
        if (error instanceof Error) {
          span.recordException(error);
          return;
        }
        span.recordException({ name: 'UnknownError', message: String(error) });
      },
      setAttributes: (nextAttributes: AttributeMap) => {
        span.setAttributes(nextAttributes);
      },
      setStatusError: (message?: string) => {
        span.setStatus({
          code: this.spanStatusCode?.ERROR ?? 2,
          message: message || 'error'
        });
      },
      end: () => span.end()
    };
  }

  async withSpan<T>(
    name: string,
    attributes: AttributeMap | undefined,
    fn: (span: TelemetrySpan) => Promise<T>
  ): Promise<T> {
    if (!this.isEnabled()) {
      return fn(this.noopSpan);
    }

    return this.tracer.startActiveSpan(name, async (rawSpan: any) => {
      const span: TelemetrySpan = {
        addEvent: (eventName: string, eventAttributes?: AttributeMap) => {
          rawSpan.addEvent(eventName, eventAttributes || {});
        },
        recordException: (error: unknown) => {
          if (error instanceof Error) {
            rawSpan.recordException(error);
            return;
          }
          rawSpan.recordException({ name: 'UnknownError', message: String(error) });
        },
        setAttributes: (nextAttributes: AttributeMap) => {
          rawSpan.setAttributes(nextAttributes);
        },
        setStatusError: (message?: string) => {
          rawSpan.setStatus({
            code: this.spanStatusCode?.ERROR ?? 2,
            message: message || 'error'
          });
        },
        end: () => rawSpan.end()
      };

      if (attributes && Object.keys(attributes).length > 0) {
        rawSpan.setAttributes(attributes);
      }

      try {
        return await fn(span);
      } catch (error) {
        span.recordException(error);
        span.setStatusError(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  getActiveTraceContext(): { traceId?: string; spanId?: string } {
    if (!this.isEnabled()) return {};
    try {
      const span = this.traceApi.getSpan(this.contextApi.active());
      if (!span) return {};
      const ctx = span.spanContext?.();
      if (!ctx) return {};
      return {
        traceId: ctx.traceId,
        spanId: ctx.spanId
      };
    } catch {
      return {};
    }
  }
}

export const telemetry = TelemetryService.getInstance();
