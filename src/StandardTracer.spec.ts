import {
  createTraceState,
  diag,
  DiagLogLevel,
  SpanKind,
  TraceFlags,
  trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_SERVICE_INSTANCE_ID,
} from "@opentelemetry/semantic-conventions";
import type {
  ConfigOTelInterface,
  TraceSampler,
} from "./models/ConfigOTelInterface";
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

jest.mock("@opentelemetry/sdk-trace", () => {
  const actual = jest.requireActual<typeof import("@opentelemetry/sdk-trace")>(
    "@opentelemetry/sdk-trace",
  );
  const batchProcessorOptions: unknown[] = [];
  class RecordingBatchSpanProcessor extends actual.BatchSpanProcessor {
    constructor(
      options: ConstructorParameters<typeof actual.BatchSpanProcessor>[0],
    ) {
      super(options);
      batchProcessorOptions.push(options);
    }
  }
  const tracerProviderOptions: unknown[] = [];
  class RecordingTracerProvider extends actual.TracerProvider {
    constructor(
      options: ConstructorParameters<typeof actual.TracerProvider>[0],
    ) {
      super(options);
      tracerProviderOptions.push(options);
    }
  }
  return {
    ...actual,
    BatchSpanProcessor: RecordingBatchSpanProcessor,
    TracerProvider: RecordingTracerProvider,
    __batchProcessorOptions: batchProcessorOptions,
    __tracerProviderOptions: tracerProviderOptions,
  };
});

interface SdkTraceMock {
  __batchProcessorOptions: unknown[];
  __tracerProviderOptions: unknown[];
}

function batchProcessorOptions(): unknown[] {
  return (jest.requireMock("@opentelemetry/sdk-trace") as SdkTraceMock)
    .__batchProcessorOptions;
}

function tracerProviderOptions(): unknown[] {
  return (jest.requireMock("@opentelemetry/sdk-trace") as SdkTraceMock)
    .__tracerProviderOptions;
}

interface RecordedTracerProviderOptions {
  sampler: { toString(): string };
}

function lastSampler(): string {
  const options = tracerProviderOptions();
  return (
    options[options.length - 1] as RecordedTracerProviderOptions
  ).sampler.toString();
}

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
  return mockExporterConstructor.mock.results[index].value as MockTraceExporter;
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

function tracerConfig(serviceId: string, url?: string): ConfigOTelInterface {
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
    batchProcessorOptions().length = 0;
    tracerProviderOptions().length = 0;
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

    it("accepts an API span as the parent", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const apiSpan = trace.wrapSpanContext({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
      });

      const child = tracer.startSpan("child-operation", apiSpan);

      expect(child.spanContext().traceId).toBe(
        "0af7651916cd43dd8448eb211c80319c",
      );
      expect(child.parentSpanContext?.spanId).toBe("b7ad6b7169203331");
      expect(child.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
      expect(child.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
      child.end();
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

    it("injects tracestate and does not propagate baggage", () => {
      const apiSpan = trace.wrapSpanContext({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
        traceState: createTraceState("vendor=opaque"),
      });
      const headers = StandardTracer.updateHttpHeader(apiSpan);

      expect(headers.traceparent).toContain("0af7651916cd43dd8448eb211c80319c");
      expect(headers.tracestate).toBe("vendor=opaque");
      expect(headers.baggage).toBeUndefined();
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
        timeoutMillis: 10000,
        compression: "none",
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
        timeoutMillis: 10000,
        compression: "none",
      });
      await exportTracer.shutdown();
    });

    it("resolves without a collector", async () => {
      const plainTracer = makeTracer(tracerConfig("plain-service"));
      await expect(plainTracer.shutdown()).resolves.toBeUndefined();
    });

    it("forwards generic headers, request timeout and gzip compression", async () => {
      const tracer = makeTracer({
        ...tracerConfig("export-service", "https://collector/v1/traces"),
        OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: { "X-Tenant": "acme" },
        OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS: 5000,
        OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION: "gzip",
      });

      expect(mockExporterConstructor).toHaveBeenCalledWith({
        url: "https://collector/v1/traces",
        headers: { "X-Tenant": "acme" },
        timeoutMillis: 5000,
        compression: "gzip",
      });
      await tracer.shutdown();
    });

    it("rejects a malformed collector URL without creating an exporter", () => {
      expect(() =>
        makeTracer(tracerConfig("export-service", "ftp://collector/v1/traces")),
      ).toThrow(
        "[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_TRACES must be a valid http(s) URL",
      );
      expect(() =>
        makeTracer(tracerConfig("export-service", "not a url")),
      ).toThrow(
        "[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_TRACES must be a valid http(s) URL",
      );
      expect(mockExporterConstructor).not.toHaveBeenCalled();
    });

    it("warns exactly once when a bearer token is sent over plain HTTP", () => {
      makeTracer({
        ...tracerConfig("export-service", "http://collector/v1/traces"),
        OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0] as string;
      expect(message).toContain("plain HTTP");
      expect(message).not.toContain("secret");
    });

    it("does not warn for https with a bearer token", () => {
      makeTracer({
        ...tracerConfig("export-service", "https://collector/v1/traces"),
        OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("trace batch tunables", () => {
    it("passes the documented defaults to BatchSpanProcessor", () => {
      makeTracer(tracerConfig("batch-service", "https://collector/v1/traces"));

      expect(batchProcessorOptions()).toHaveLength(1);
      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        scheduledDelayMillis: 5000,
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        exportTimeoutMillis: 30000,
      });
    });

    it("passes configured batch values to BatchSpanProcessor", () => {
      makeTracer({
        ...tracerConfig("batch-service", "https://collector/v1/traces"),
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS: 2,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_QUEUE_SIZE: 4096,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_BATCH_SIZE: 1024,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_TIMEOUT_MILLIS: 15000,
      });

      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        scheduledDelayMillis: 2000,
        maxQueueSize: 4096,
        maxExportBatchSize: 1024,
        exportTimeoutMillis: 15000,
      });
    });

    it.each([0, -5, 0.5])(
      "clamps the trace export interval of %p seconds to one second",
      (interval) => {
        makeTracer({
          ...tracerConfig("batch-service", "https://collector/v1/traces"),
          OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS: interval,
        });

        expect(batchProcessorOptions()[0]).toEqual(
          expect.objectContaining({ scheduledDelayMillis: 1000 }),
        );
      },
    );

    it("falls back to the documented defaults for invalid batch values", () => {
      makeTracer({
        ...tracerConfig("batch-service", "https://collector/v1/traces"),
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS: NaN,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_QUEUE_SIZE: 0,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_BATCH_SIZE: -1,
        OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_TIMEOUT_MILLIS: 1.5,
      });

      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        scheduledDelayMillis: 5000,
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        exportTimeoutMillis: 30000,
      });
    });
  });

  describe("forceFlush", () => {
    it("flushes buffered spans without shutting the provider down", async () => {
      const tracer = makeTracer(
        tracerConfig("flush-service", "http://collector/v1/traces"),
      );
      tracer.startSpan("flushed-span").end();

      await tracer.forceFlush();

      expect(spanNames(exporterAt(0))).toContain("flushed-span");
      expect(exporterAt(0).shutdown).not.toHaveBeenCalled();

      tracer.startSpan("after-flush").end();
      await tracer.forceFlush();
      expect(spanNames(exporterAt(0))).toContain("after-flush");
      await tracer.shutdown();
    });

    it("resolves without a collector", async () => {
      const tracer = makeTracer(tracerConfig("plain-service"));

      await expect(tracer.forceFlush()).resolves.toBeUndefined();
    });
  });

  describe("service identity validation", () => {
    it("rejects an empty SERVICE_ID", () => {
      expect(
        () => new StandardTracer({ SERVICE_ID: "   ", VERSION: "1.0.0" }),
      ).toThrow("[otel-utils] SERVICE_ID must be a non-empty string");
    });

    it("rejects an empty VERSION", () => {
      expect(
        () => new StandardTracer({ SERVICE_ID: "test-service", VERSION: "" }),
      ).toThrow("[otel-utils] VERSION must be a non-empty string");
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
        expect.stringContaining(
          "A global tracer provider is already registered",
        ),
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

    it("documents the single-instance contract: a second instance never replaces the global provider", async () => {
      const first = makeTracer(
        tracerConfig("svc-1", "http://collector-1/v1/traces"),
      );
      const firstProvider = registeredTracerProvider();

      const second = makeTracer(
        tracerConfig("svc-2", "http://collector-2/v1/traces"),
      );

      expect(registeredTracerProvider()).toBe(firstProvider);
      await second.shutdown();
      expect(registeredTracerProvider()).toBe(firstProvider);
      await first.shutdown();
    });
  });

  describe("trace sampling", () => {
    it.each([
      ["always_on", undefined, /^AlwaysOnSampler$/],
      ["always_off", undefined, /^AlwaysOffSampler$/],
      ["traceidratio", 0.5, /^TraceIdRatioBased\{0\.5\}$/],
      [
        "parentbased_always_on",
        undefined,
        /^ParentBased\{root=AlwaysOnSampler/,
      ],
      [
        "parentbased_always_off",
        undefined,
        /^ParentBased\{root=AlwaysOffSampler/,
      ],
      [
        "parentbased_traceidratio",
        0.25,
        /^ParentBased\{root=TraceIdRatioBased\{0\.25\}/,
      ],
    ] as const)(
      "maps the %p sampler to the SDK sampler",
      (sampler, ratio, expected) => {
        makeTracer({
          ...tracerConfig("sampler-service"),
          OPENTELEMETRY_TRACES_SAMPLER: sampler as TraceSampler,
          OPENTELEMETRY_TRACES_SAMPLER_ARG: ratio,
        });

        expect(lastSampler()).toMatch(expected);
        expect(warnSpy).not.toHaveBeenCalled();
      },
    );

    it("defaults to parentbased_always_on without warning", () => {
      makeTracer(tracerConfig("sampler-service"));

      expect(lastSampler()).toMatch(/^ParentBased\{root=AlwaysOnSampler/);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("warns once and falls back to parentbased_always_on for an invalid sampler", () => {
      makeTracer({
        ...tracerConfig("sampler-service"),
        OPENTELEMETRY_TRACES_SAMPLER: "sometimes" as TraceSampler,
      });

      expect(lastSampler()).toMatch(/^ParentBased\{root=AlwaysOnSampler/);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_TRACES_SAMPLER"),
      );
    });

    it("drops spans with always_off and exports them with the default sampler", async () => {
      const offTracer = makeTracer({
        ...tracerConfig("off-service", "http://collector-off/v1/traces"),
        OPENTELEMETRY_TRACES_SAMPLER: "always_off",
      });
      const droppedSpan = offTracer.startSpan("dropped");
      expect(droppedSpan.isRecording()).toBe(false);
      droppedSpan.end();
      await offTracer.shutdown();
      expect(spanNames(exporterAt(0))).toEqual([]);

      const defaultTracer = makeTracer(
        tracerConfig("on-service", "http://collector-on/v1/traces"),
      );
      const keptSpan = defaultTracer.startSpan("kept");
      expect(keptSpan.isRecording()).toBe(true);
      keptSpan.end();
      await defaultTracer.shutdown();
      expect(spanNames(exporterAt(1))).toEqual(["kept"]);
    });
  });

  describe("span options", () => {
    it("accepts attributes, links and start time at creation without synthetic attributes", () => {
      const tracer = makeTracer(tracerConfig("test-service"));
      const linkedSpan = trace.wrapSpanContext({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: TraceFlags.SAMPLED,
      });
      const startTime = new Date(Date.now() - 5000);

      const span = tracer.startSpan("described-operation", undefined, {
        kind: SpanKind.CLIENT,
        attributes: { "custom.attr": "value", "custom.count": 3 },
        links: [
          {
            context: linkedSpan.spanContext(),
            attributes: { "link.type": "retry" },
          },
        ],
        startTime,
      });

      expect(span.kind).toBe(SpanKind.CLIENT);
      expect(span.attributes["custom.attr"]).toBe("value");
      expect(span.attributes["custom.count"]).toBe(3);
      expect(span.links).toHaveLength(1);
      expect(span.links[0].context.spanId).toBe("b7ad6b7169203331");
      expect(span.links[0].attributes?.["link.type"]).toBe("retry");
      expect(span.startTime[0]).toBe(Math.floor(startTime.getTime() / 1000));
      span.setAttribute("post.creation", true);
      expect(span.attributes["post.creation"]).toBe(true);
      expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
      expect(span.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
      span.end();
    });
  });

  describe("resource identity", () => {
    it("adds the instance, environment and custom attributes to exported spans", async () => {
      const tracer = makeTracer({
        ...tracerConfig("resource-service", "http://collector/v1/traces"),
        SERVICE_INSTANCE_ID: "pod-7",
        DEPLOYMENT_ENVIRONMENT_NAME: "production",
        OPENTELEMETRY_RESOURCE_ATTRIBUTES: {
          "deployment.tier": "web",
          replicas: 3,
        },
      });

      tracer.startSpan("with-resource").end();
      await tracer.shutdown();

      const [span] = exporterAt(0).getExportedSpans();
      expect(span.resource.attributes[ATTR_SERVICE_INSTANCE_ID]).toBe("pod-7");
      expect(span.resource.attributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME]).toBe(
        "production",
      );
      expect(span.resource.attributes["deployment.tier"]).toBe("web");
      expect(span.resource.attributes.replicas).toBe(3);
    });

    it("keeps the default resource attributes when the new fields are unset", async () => {
      const tracer = makeTracer(
        tracerConfig("plain-service", "http://collector/v1/traces"),
      );

      tracer.startSpan("plain-span").end();
      await tracer.shutdown();

      const [span] = exporterAt(0).getExportedSpans();
      expect(span.resource.attributes["service.name"]).toBe("plain-service");
      expect(
        span.resource.attributes[ATTR_SERVICE_INSTANCE_ID],
      ).toBeUndefined();
      expect(
        span.resource.attributes[ATTR_DEPLOYMENT_ENVIRONMENT_NAME],
      ).toBeUndefined();
    });
  });
});
