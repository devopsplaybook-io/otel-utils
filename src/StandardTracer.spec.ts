import {
  diag,
  DiagLogLevel,
  SpanKind,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { StandardTracer } from "./StandardTracer";

jest.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  const { ExportResultCode } = jest.requireActual<
    typeof import("@opentelemetry/core")
  >("@opentelemetry/core");
  return {
    OTLPTraceExporter: jest.fn().mockImplementation(function () {
      const exportedSpans: ExportedSpan[] = [];
      return {
        export: (
          spans: ExportedSpan[],
          resultCallback: (result: { code: number }) => void,
        ) => {
          exportedSpans.push(...spans);
          resultCallback({ code: ExportResultCode.SUCCESS });
        },
        forceFlush: jest.fn().mockResolvedValue(undefined),
        shutdown: jest.fn().mockResolvedValue(undefined),
        getExportedSpans: () => exportedSpans,
      };
    }),
  };
});

interface ExportedSpan {
  name: string;
  resource: { attributes: Record<string, unknown> };
}

interface MockTraceExporter {
  export: jest.Mock;
  forceFlush: jest.Mock;
  shutdown: jest.Mock;
  getExportedSpans: () => ExportedSpan[];
}

const mockExporterConstructor = OTLPTraceExporter as unknown as jest.Mock;

function exporterAt(index: number): MockTraceExporter {
  return mockExporterConstructor.mock.results[index]
    .value as MockTraceExporter;
}

function lastExporter(): MockTraceExporter {
  return exporterAt(mockExporterConstructor.mock.results.length - 1);
}

function registeredTracerProvider(): unknown {
  const provider = trace.getTracerProvider() as unknown as {
    getDelegate?: () => unknown;
  };
  return typeof provider.getDelegate === "function"
    ? provider.getDelegate()
    : provider;
}

function tracerConfig(
  serviceId: string,
  url?: string,
): ConfigOTelInterface {
  return {
    SERVICE_ID: serviceId,
    VERSION: "1.0.0",
    OPENTELEMETRY_COLLECTOR_HTTP_TRACES: url,
  };
}

function spanNames(exporter: MockTraceExporter): string[] {
  return exporter.getExportedSpans().map((span) => span.name);
}

describe("StandardTracer", () => {
  const createdTracers: StandardTracer[] = [];
  let warnSpy: jest.SpyInstance;

  function makeTracer(config: ConfigOTelInterface): StandardTracer {
    const tracer = new StandardTracer(config);
    createdTracers.push(tracer);
    return tracer;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    trace.disable();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const tracer of createdTracers.splice(0)) {
      await tracer.shutdown();
    }
    trace.disable();
    warnSpy.mockRestore();
  });

  describe("startSpan", () => {
    it("sanitizes span names", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const span = tracer.startSpan("GET-/api/files/:id");
      expect(span.name).toBe("GET-/api/files/_id");
      span.end();
    });

    it("keeps the default parentless behavior when no options are given", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const span = tracer.startSpan("my-operation");
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBe("BACKEND");
      expect(span.attributes[ATTR_HTTP_ROUTE]).toBe(
        "test-service-1.0.0-my-operation",
      );
      span.end();
    });

    it("creates a child of the parent span without synthetic attributes", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const parent = tracer.startSpan("parent-operation");
      const child = tracer.startSpan("child-operation", parent);
      expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
      expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      expect(child.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
      expect(child.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
      child.end();
      parent.end();
    });

    it("applies the options instead of the synthetic attributes", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const span = tracer.startSpan("GET-/api/files/:id", undefined, {
        kind: SpanKind.SERVER,
      });
      expect(span.kind).toBe(SpanKind.SERVER);
      expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
      expect(span.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
      span.end();
    });

    it("combines the options with a parent span", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const parent = tracer.startSpan("parent-operation");
      const child = tracer.startSpan("child-operation", parent, {
        kind: SpanKind.CLIENT,
      });
      expect(child.kind).toBe(SpanKind.CLIENT);
      expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
      expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      child.end();
      parent.end();
    });
  });

  describe("updateHttpHeader", () => {
    it("injects the W3C trace context into a new headers object", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const span = tracer.startSpan("propagated");
      const headers = StandardTracer.updateHttpHeader(span);

      expect(headers.traceparent).toMatch(/^00-/);
      expect(headers.traceparent).toContain(span.spanContext().traceId);
      span.end();
    });

    it("injects into and returns the provided headers object", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const span = tracer.startSpan("propagated");
      const headers: Record<string, string> = { "x-custom": "value" };
      const result = StandardTracer.updateHttpHeader(span, headers);

      expect(result).toBe(headers);
      expect(headers["x-custom"]).toBe("value");
      expect(headers["traceparent"]).toContain(span.spanContext().traceId);
      span.end();
    });
  });

  describe("exporter configuration", () => {
    it("builds the trace exporter with URL and auth header and shuts it down", async () => {
      const exportTracer = makeTracer({
        SERVICE_ID: "export-service",
        VERSION: "2.0.0",
        OPENTELEMETRY_COLLECTOR_HTTP_TRACES: "http://collector:4318/v1/traces",
        OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
      });

      expect(mockExporterConstructor).toHaveBeenCalledWith({
        url: "http://collector:4318/v1/traces",
        headers: { Authorization: "Bearer secret" },
      });

      await exportTracer.shutdown();
      expect(lastExporter().shutdown).toHaveBeenCalled();
    });

    it("builds the trace exporter without auth header", async () => {
      const exportTracer = makeTracer({
        SERVICE_ID: "export-service",
        VERSION: "2.0.0",
        OPENTELEMETRY_COLLECTOR_HTTP_TRACES: "http://collector:4318/v1/traces",
      });

      expect(mockExporterConstructor).toHaveBeenCalledWith({
        url: "http://collector:4318/v1/traces",
        headers: {},
      });
      await exportTracer.shutdown();
    });

    it("resolves without a collector", async () => {
      const plainTracer = makeTracer(tracerConfig("plain-service"));
      await expect(plainTracer.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("provider ownership and global registration", () => {
    it("routes each instance to its own exporter and resource", async () => {
      const first = makeTracer(
        tracerConfig("svc-1", "http://collector-1/v1/traces"),
      );
      const second = makeTracer(
        tracerConfig("svc-2", "http://collector-2/v1/traces"),
      );

      first.startSpan("span-from-svc1").end();
      second.startSpan("span-from-svc2").end();

      await first.shutdown();
      await second.shutdown();

      const firstSpans = exporterAt(0).getExportedSpans();
      const secondSpans = exporterAt(1).getExportedSpans();
      expect(firstSpans.map((span) => span.name)).toEqual(["span-from-svc1"]);
      expect(secondSpans.map((span) => span.name)).toEqual(["span-from-svc2"]);
      expect(firstSpans[0].resource.attributes["service.name"]).toBe("svc-1");
      expect(secondSpans[0].resource.attributes["service.name"]).toBe("svc-2");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("A global tracer provider is already registered"),
      );
    });

    it("routes global API spans to the first registered provider", async () => {
      const first = makeTracer(
        tracerConfig("svc-1", "http://collector-1/v1/traces"),
      );
      const second = makeTracer(
        tracerConfig("svc-2", "http://collector-2/v1/traces"),
      );

      trace.getTracer("global").startSpan("global-span").end();
      second.startSpan("second-span").end();

      await first.shutdown();
      await second.shutdown();

      expect(spanNames(exporterAt(0))).toEqual(["global-span"]);
      expect(spanNames(exporterAt(1))).toEqual(["second-span"]);
    });

    it("only the owner disables the global provider and re-registration works", async () => {
      const first = makeTracer(
        tracerConfig("svc-1", "http://collector-1/v1/traces"),
      );
      const second = makeTracer(
        tracerConfig("svc-2", "http://collector-2/v1/traces"),
      );

      await second.shutdown();
      expect(registeredTracerProvider()).toBeInstanceOf(TracerProvider);

      trace.getTracer("global").startSpan("after-second-shutdown").end();
      await first.shutdown();
      expect(registeredTracerProvider()).not.toBeInstanceOf(TracerProvider);
      expect(spanNames(exporterAt(0))).toContain("after-second-shutdown");

      const third = makeTracer(
        tracerConfig("svc-3", "http://collector-3/v1/traces"),
      );
      trace.getTracer("global").startSpan("after-reinit").end();
      await third.shutdown();

      expect(spanNames(exporterAt(2))).toEqual(["after-reinit"]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it("shuts down idempotently", async () => {
      const tracer = makeTracer(
        tracerConfig("svc-1", "http://collector-1/v1/traces"),
      );
      tracer.startSpan("only-span").end();

      await tracer.shutdown();
      await tracer.shutdown();

      expect(exporterAt(0).shutdown).toHaveBeenCalledTimes(1);
      expect(spanNames(exporterAt(0))).toEqual(["only-span"]);
    });

    it("emits no duplicate-registration diagnostics for a normal startup", async () => {
      const errors: unknown[][] = [];
      diag.setLogger(
        {
          error: (...args: unknown[]) => errors.push(args),
          warn: () => {},
          info: () => {},
          debug: () => {},
          verbose: () => {},
        },
        DiagLogLevel.ERROR,
      );
      try {
        makeTracer(tracerConfig("svc-1", "http://collector-1/v1/traces"));
        makeTracer(tracerConfig("svc-2", "http://collector-2/v1/traces"));
      } finally {
        diag.disable();
      }

      expect(errors).toEqual([]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
