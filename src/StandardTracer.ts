import opentelemetry, {
  defaultTextMapSetter,
  ROOT_CONTEXT,
  trace,
  Tracer,
} from "@opentelemetry/api";
import { AsyncHooksContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, Span } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_ROUTE,
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";

export class StandardTracer {
  private tracer: Tracer;
  private serviceVersion: string;
  private serviceName: string;

  constructor(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    const spanProcessors = [];

    if (config.OPENTELEMETRY_COLLECTOR_HTTP_TRACES) {
      const exporterHeaders: Record<string, string> = {};
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        exporterHeaders[
          "Authorization"
        ] = `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const exporter = new OTLPTraceExporter({
        url: config.OPENTELEMETRY_COLLECTOR_HTTP_TRACES,
        headers: exporterHeaders,
      });
      spanProcessors.push(new BatchSpanProcessor(exporter));
    }
    const traceProvider = new NodeTracerProvider({
      idGenerator: new AWSXRayIdGenerator(),
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: `${this.serviceName}`,
        [ATTR_SERVICE_VERSION]: `${this.serviceVersion}`,
        [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
      }),
      spanProcessors,
    });
    traceProvider.register();
    const contextManager = new AsyncHooksContextManager();
    contextManager.enable();
    opentelemetry.context.setGlobalContextManager(contextManager);
    this.tracer = opentelemetry.trace.getTracer(
      `${this.serviceName}:${this.serviceVersion}`
    );
  }

  public startSpan(name: string, parentSpan?: Span): Span {
    const sanitizedName = String(name).replace(/[^a-zA-Z0-9-_/]/g, "_");
    if (parentSpan) {
      return this.tracer.startSpan(
        sanitizedName,
        undefined,
        opentelemetry.trace.setSpan(opentelemetry.context.active(), parentSpan)
      ) as Span;
    }
    const span = this.tracer.startSpan(sanitizedName) as Span;
    span.setAttribute(ATTR_HTTP_REQUEST_METHOD, `BACKEND`);
    span.setAttribute(
      ATTR_HTTP_ROUTE,
      `${this.serviceName}-${this.serviceVersion}-${sanitizedName}`
    );
    return span;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static updateHttpHeader(context: Span, headers = {}): any {
    if (!headers) {
      headers = {};
    }
    const propagator = new W3CTraceContextPropagator();
    propagator.inject(
      trace.setSpanContext(ROOT_CONTEXT, context.spanContext()),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers as any,
      defaultTextMapSetter
    );
    return headers;
  }
}
