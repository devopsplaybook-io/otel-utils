import { SpanKind } from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { StandardTracer } from "./StandardTracer";

describe("StandardTracer", () => {
  let tracer: StandardTracer;

  beforeAll(() => {
    tracer = new StandardTracer({
      SERVICE_ID: "test-service",
      VERSION: "1.0.0",
    });
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
});
