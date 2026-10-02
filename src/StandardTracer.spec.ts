import { SpanKind } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { StandardTracer } from "./StandardTracer";

jest.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  const { ExportResultCode } = jest.requireActual<
    typeof import("@opentelemetry/core")
  >("@opentelemetry/core");
  return {
    OTLPTraceExporter: jest.fn().mockImplementation(function () {
      return {
        export: (
          _spans: unknown,
          resultCallback: (result: { code: number }) => void,
        ) => resultCallback({ code: ExportResultCode.SUCCESS }),
        forceFlush: jest.fn().mockResolvedValue(undefined),
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
    }),
  };
});

interface MockTraceExporter {
  export: jest.Mock;
  forceFlush: jest.Mock;
  shutdown: jest.Mock;
}

const mockExporterConstructor = OTLPTraceExporter as unknown as jest.Mock;

function lastExporter(): MockTraceExporter {
  const results = mockExporterConstructor.mock.results;
  return results[results.length - 1].value as MockTraceExporter;
}

describe("StandardTracer", () => {
  let tracer: StandardTracer;

  beforeAll(() => {
    tracer = new StandardTracer({
      SERVICE_ID: "test-service",
      VERSION: "1.0.0",
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("startSpan", () => {
    it("sanitizes span names", () => {
      const span = tracer.startSpan("GET-/api/files/:id");
      expect(span.name).toBe("GET-/api/files/_id");
      span.end();
    });

    it("keeps the default parentless behavior when no options are given", () => {
      const span = tracer.startSpan("my-operation");
      expect(span.kind).toBe(SpanKind.INTERNAL);
      expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBe("BACKEND");
      expect(span.attributes[ATTR_HTTP_ROUTE]).toBe(
        "test-service-1.0.0-my-operation",
      );
      span.end();
    });

    it("creates a child of the parent span without synthetic attributes", () => {
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
      const span = tracer.startSpan("GET-/api/files/:id", undefined, {
        kind: SpanKind.SERVER,
      });
      expect(span.kind).toBe(SpanKind.SERVER);
      expect(span.attributes[ATTR_HTTP_REQUEST_METHOD]).toBeUndefined();
      expect(span.attributes[ATTR_HTTP_ROUTE]).toBeUndefined();
      span.end();
    });

    it("combines the options with a parent span", () => {
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
      const span = tracer.startSpan("propagated");
      const headers = StandardTracer.updateHttpHeader(span);

      expect(headers.traceparent).toMatch(/^00-/);
      expect(headers.traceparent).toContain(span.spanContext().traceId);
      span.end();
    });

    it("injects into and returns the provided headers object", () => {
      const span = tracer.startSpan("propagated");
      const headers: Record<string, string> = { "x-custom": "value" };
      const result = StandardTracer.updateHttpHeader(span, headers);

      expect(result).toBe(headers);
      expect(headers["x-custom"]).toBe("value");
      expect(headers["traceparent"]).toContain(span.spanContext().traceId);
      span.end();
    });
  });

  describe("shutdown", () => {
    it("builds the trace exporter with URL and auth header and shuts it down", async () => {
      const exportTracer = new StandardTracer({
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
      const exportTracer = new StandardTracer({
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
      const plainTracer = new StandardTracer({
        SERVICE_ID: "plain-service",
        VERSION: "1.0.0",
      });

      await expect(plainTracer.shutdown()).resolves.toBeUndefined();
    });
  });
});
