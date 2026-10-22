import {
  context,
  defaultTextMapSetter,
  ROOT_CONTEXT,
  SpanKind,
  trace,
  Tracer,
} from "@opentelemetry/api";
import type { Span as ApiSpan } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import {
  BatchSpanProcessor,
  type Span,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { createOTelResource } from "./utils/createResource";

let globalTracerProvider: TracerProvider | undefined;
let contextManagerInitialized = false;

function getRegisteredTracerProvider(): unknown {
  const provider = trace.getTracerProvider() as unknown as {
    getDelegate?: () => unknown;
  };
  return typeof provider.getDelegate === "function"
    ? provider.getDelegate()
    : provider;
}

const ALREADY_REGISTERED_WARNING =
  "[otel-utils] A global tracer provider is already registered; StandardTracer will not replace it. This instance still exports spans through its own provider, but trace.getTracer() keeps using the existing provider.";

/**
 * Options accepted by {@link StandardTracer.startSpan}.
 */
export interface StandardTracerStartSpanOptions {
  /**
   * OpenTelemetry span kind (default `SpanKind.INTERNAL`).
   *
   * Providing options means the caller describes the span itself: the
   * parentless default attributes (`http.request.method=BACKEND` and the
   * synthetic `http.route`) are not added.
   */
  kind?: SpanKind;
}

export class StandardTracer {
  private static readonly SPAN_NAME_SANITIZE_RE = /[^a-zA-Z0-9-_/]/g;
  private static readonly PROPAGATOR = new W3CTraceContextPropagator();

  private traceProvider: TracerProvider;
  private tracer: Tracer;
  private serviceVersion: string;
  private serviceName: string;
  private ownsGlobalProvider = false;
  private shutdownPromise?: Promise<void>;

  constructor(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    const spanProcessors = [];

    if (config.OPENTELEMETRY_COLLECTOR_HTTP_TRACES) {
      const exporterHeaders: Record<string, string> = {};
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        exporterHeaders["Authorization"] =
          `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const exporter = new OTLPTraceExporter({
        url: config.OPENTELEMETRY_COLLECTOR_HTTP_TRACES,
        headers: exporterHeaders,
      });
      spanProcessors.push(new BatchSpanProcessor({ exporter }));
    }
    this.traceProvider = new TracerProvider({
      idGenerator: new AWSXRayIdGenerator(),
      resource: createOTelResource(this.serviceName, this.serviceVersion),
      spanProcessors,
    });
    // Resolve the tracer from this instance's provider: the global API may be
    // owned by another instance and would silently export through it.
    this.tracer = this.traceProvider.getTracer(
      `${this.serviceName}:${this.serviceVersion}`,
    );
    this.registerGlobalProvider();
    initializeContextManager();
  }

  public shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.doShutdown();
    }
    return this.shutdownPromise;
  }

  public startSpan(
    name: string,
    parentSpan?: Span,
    options?: StandardTracerStartSpanOptions,
  ): Span {
    const sanitizedName = name.replace(
      StandardTracer.SPAN_NAME_SANITIZE_RE,
      "_",
    );
    if (parentSpan) {
      return this.tracer.startSpan(
        sanitizedName,
        options,
        trace.setSpan(context.active(), parentSpan),
      ) as Span;
    }
    if (options) {
      return this.tracer.startSpan(sanitizedName, options) as Span;
    }
    const span = this.tracer.startSpan(sanitizedName) as Span;
    span.setAttribute(ATTR_HTTP_REQUEST_METHOD, `BACKEND`);
    span.setAttribute(
      ATTR_HTTP_ROUTE,
      `${this.serviceName}-${this.serviceVersion}-${sanitizedName}`,
    );
    return span;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static updateHttpHeader(context: ApiSpan, headers = {}): any {
    StandardTracer.PROPAGATOR.inject(
      trace.setSpanContext(ROOT_CONTEXT, context.spanContext()),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers as any,
      defaultTextMapSetter,
    );
    return headers;
  }

  private registerGlobalProvider(): void {
    if (globalTracerProvider) {
      if (getRegisteredTracerProvider() === globalTracerProvider) {
        console.warn(ALREADY_REGISTERED_WARNING);
        return;
      }
      // The previous provider is no longer registered (disabled elsewhere).
      globalTracerProvider = undefined;
    }
    if (trace.setGlobalTracerProvider(this.traceProvider)) {
      globalTracerProvider = this.traceProvider;
      this.ownsGlobalProvider = true;
    } else {
      console.warn(ALREADY_REGISTERED_WARNING);
    }
  }

  private async doShutdown(): Promise<void> {
    await this.traceProvider.shutdown();
    if (
      this.ownsGlobalProvider &&
      getRegisteredTracerProvider() === this.traceProvider
    ) {
      trace.disable();
    }
    if (globalTracerProvider === this.traceProvider) {
      globalTracerProvider = undefined;
    }
    this.ownsGlobalProvider = false;
  }
}

function initializeContextManager(): void {
  if (contextManagerInitialized) {
    return;
  }
  contextManagerInitialized = true;
  const contextManager = new AsyncLocalStorageContextManager();
  if (context.setGlobalContextManager(contextManager)) {
    contextManager.enable();
  } else {
    console.warn(
      "[otel-utils] A global context manager is already registered; StandardTracer will keep using it for context propagation.",
    );
  }
}
