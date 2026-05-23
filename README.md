# otel-utils

Utility library that simplifies OpenTelemetry integration for Node.js services. Provides standardized tracing, structured logging, and metrics export with minimal boilerplate.

## Installation

```bash
npm install @devopsplaybook.io/otel-utils
```

## Configuration

All classes accept a `ConfigOTelInterface` object:

| Field                                                     | Type       | Default | Description                     |
| --------------------------------------------------------- | ---------- | ------- | ------------------------------- |
| `SERVICE_ID`                                              | `string`   | —       | Service identifier (required)   |
| `VERSION`                                                 | `string`   | —       | Service version (required)      |
| `OPENTELEMETRY_COLLECTOR_HTTP_TRACES`                     | `string?`  | —       | OTLP HTTP endpoint for traces   |
| `OPENTELEMETRY_COLLECTOR_HTTP_METRICS`                    | `string?`  | —       | OTLP HTTP endpoint for metrics  |
| `OPENTELEMETRY_COLLECTOR_HTTP_LOGS`                       | `string?`  | —       | OTLP HTTP endpoint for logs     |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS`    | `number?`  | `60`    | Log export interval             |
| `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS` | `number?`  | `60`    | Metrics export interval         |
| `OPENTELEMETRY_COLLECTOR_AWS`                             | `boolean?` | —       | AWS-specific feature flag       |
| `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER`              | `string?`  | —       | Bearer token for collector auth |

When a collector endpoint is not provided, the corresponding signal (traces, logs, or metrics) is initialized with no export — the provider is still available but no data is sent.

## Exported Classes

### StandardTracer

Sets up a global `NodeTracerProvider` with:

- AWS X-Ray ID generator (`AWSXRayIdGenerator`)
- OTLP HTTP trace exporter (optional, when `OPENTELEMETRY_COLLECTOR_HTTP_TRACES` is set)
- `AsyncHooksContextManager` for automatic context propagation
- Service resource attributes (name, version, hostname)

```typescript
import { StandardTracer } from "@devopsplaybook.io/otel-utils";

const tracer = new StandardTracer(config);
const span = tracer.startSpan("my-operation");
// ... do work ...
span.end();
```

**Methods:**

- `startSpan(name, parentSpan?)` — Creates a span. When no `parentSpan` is provided, adds `http.request_method=BACKEND` and `http.route` attributes. Span names are sanitized to `[a-zA-Z0-9-_/]`.
- `static updateHttpHeader(context, headers?)` — Injects W3C trace context into an HTTP headers object for propagation to downstream services.

### StandardLogger

Initializes a `LoggerProvider` with an OTLP log exporter and a `BatchLogRecordProcessor` (`maxQueueSize: 2048`).

```typescript
import { StandardLogger } from "@devopsplaybook.io/otel-utils";

const logger = new StandardLogger();
logger.initOTel(config);

const moduleLog = logger.createModuleLogger("my-module");
moduleLog.info("Hello world");
```

**Methods:**

- `initOTel(config)` — Initializes the logger provider and optional OTLP exporter.
- `getLogger()` — Returns the underlying OTel `Logger` or `undefined`.
- `createModuleLogger(moduleName)` — Creates a `ModuleLogger` scoped to a module name.

### ModuleLogger

Scoped logger that prefixes all output with a module name. Logs to both `console.log` and (when available) the OTel Logger.

```typescript
const log = logger.createModuleLogger("api");
log.info("request received");
log.warn("rate limit approaching");
log.error("connection failed", new Error("timeout"));
log.info("processing complete", activeSpan); // attach trace context
```

**Methods:**

- `info(message, context?)` — Log at INFO level.
- `warn(message, context?)` — Log at WARN level.
- `error(message, error?, context?)` — Log at ERROR level with optional `Error` and span context. Attaches `exception.type`, `exception.message`, and `exception.stacktrace` attributes.

When a `Span` is passed as `context`, the log record includes `span.id` and `trace.id` attributes for trace correlation.

### StandardMeter

Creates a `MeterProvider` with an optional `PeriodicExportingMetricReader` (`concurrencyLimit: 5`). Provides convenience factories for common metric types.

```typescript
import { StandardMeter } from "@devopsplaybook.io/otel-utils";

const meter = new StandardMeter(config);

const requestCount = meter.createCounter("requests.total");
requestCount.add(1);

const latency = meter.createHistogram("requests.latency");
latency.record(42);

const activeUsers = meter.createUpDownCounter("users.active");
activeUsers.add(1);

const cpuGauge = meter.createObservableGauge(
  "cpu.usage",
  (result) => result.observe(cpuPercent),
  "Current CPU usage",
);
```

**Methods:**

- `createCounter(key)` — Creates a `Counter` with name `${serviceName}.${key}`.
- `createUpDownCounter(key)` — Creates an `UpDownCounter`.
- `createHistogram(key)` — Creates a `Histogram`.
- `createObservableGauge(key, callback, description?)` — Creates an `ObservableGauge` with a callback. Description is optional.

## Internal Utilities

### createOTelResource

Shared internal utility that creates an `OTelResource` with `service.name`, `service.version`, and `network.local.address` (hostname). The hostname is cached at module load time to minimize system calls.

```typescript
// Used internally by StandardTracer, StandardLogger, and StandardMeter
```

## Architecture

```
Application
  ├── StandardTracer  ──► OTLP Trace Exporter  ──► Collector / otel-light
  ├── StandardLogger  ──► OTLP Log Exporter     ──► Collector / otel-light
  │     └── ModuleLogger (scoped per module)
  └── StandardMeter   ──► OTLP Metric Exporter  ──► Collector / otel-light
                           └── PeriodicExportingMetricReader
```

All three signals share the same service identity (name + version) and resource attributes via `createOTelResource`. Export is optional per signal — only configured when the corresponding `OPENTELEMETRY_COLLECTOR_HTTP_*` endpoint is set.

## Dependencies

- `@opentelemetry/api` / `@opentelemetry/api-logs` — OpenTelemetry API interfaces
- `@opentelemetry/sdk-trace-node` / `@opentelemetry/sdk-trace-base` — Tracing SDK
- `@opentelemetry/sdk-metrics` — Metrics SDK
- `@opentelemetry/sdk-logs` — Logging SDK
- `@opentelemetry/exporter-trace-otlp-http` / `@opentelemetry/exporter-metrics-otlp-http` / `@opentelemetry/exporter-logs-otlp-http` — OTLP HTTP exporters
- `@opentelemetry/id-generator-aws-xray` — AWS X-Ray trace ID format
- `@opentelemetry/context-async-hooks` — Async context management
- `@opentelemetry/core` — W3C trace context propagation
- `@opentelemetry/resources` / `@opentelemetry/semantic-conventions` — Resource attributes

## Build

```bash
npm run build   # tsc → dist/
```
