# otel-utils

Utility library that simplifies OpenTelemetry integration for Node.js services. Provides standardized tracing, structured logging, and metrics export with minimal boilerplate.

## Installation

```bash
npm install @devopsplaybook.io/otel-utils
```

Requires Node.js 22 or newer (`engines` in `package.json`).

## Configuration

All classes accept a `ConfigOTelInterface` object. The fields mirror environment variables in the consuming application (for example `common-utils`' `ConfigBase`); the library itself does not read `process.env`.

| Field                                                     | Type                                | Default    | Description                                         |
| --------------------------------------------------------- | ----------------------------------- | ---------- | --------------------------------------------------- |
| `SERVICE_ID`                                              | `string`                            | —          | Service identifier (required, non-empty)            |
| `VERSION`                                                 | `string`                            | —          | Service version (required, non-empty)               |
| `OPENTELEMETRY_COLLECTOR_HTTP_TRACES`                     | `string?`                           | —          | OTLP HTTP endpoint for traces                       |
| `OPENTELEMETRY_COLLECTOR_HTTP_METRICS`                    | `string?`                           | —          | OTLP HTTP endpoint for metrics                      |
| `OPENTELEMETRY_COLLECTOR_HTTP_LOGS`                       | `string?`                           | —          | OTLP HTTP endpoint for logs                         |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS`    | `number?`                           | `60`       | Log export interval in seconds (clamped to ≥ 1)     |
| `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS` | `number?`                           | `60`       | Metrics export interval in seconds (clamped to ≥ 1) |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE`      | `number?`                           | `2048`     | Max log records buffered before export              |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE`      | `number?`                           | `512`      | Max log records per export batch                    |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS`      | `number?`                           | `30000`    | Log export timeout in milliseconds                  |
| `OPENTELEMETRY_CONSOLE_LOG_MODE`                          | `"always" \| "fallback" \| "never"` | `"always"` | Console mirroring mode for `ModuleLogger`           |
| `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER`              | `string?`                           | —          | Bearer token for collector auth                     |

`SERVICE_ID` and `VERSION` must be non-empty strings. `StandardTracer`/`StandardMeter` constructors and `StandardLogger.initOTel` fail fast with `[otel-utils] SERVICE_ID must be a non-empty string` / `[otel-utils] VERSION must be a non-empty string` otherwise. A failed re-initialisation of `StandardLogger` keeps the previous provider in place.

Numeric export intervals below 1 s (including `0` and negative values from an empty environment variable) are clamped to 1 s; `NaN`/`Infinity` fall back to the 60 s default. Non-positive or non-integer batch values fall back to their defaults.

When a collector endpoint is not provided, the corresponding signal (traces, logs, or metrics) is initialized with no export: traces and metrics still have a local provider but no data is sent, and `StandardLogger` creates no provider (its `getLogger()` returns `undefined`).

## Exported Classes

### StandardTracer

Creates a `TracerProvider` with:

- AWS X-Ray ID generator (`AWSXRayIdGenerator`)
- OTLP HTTP trace exporter (optional, when `OPENTELEMETRY_COLLECTOR_HTTP_TRACES` is set)
- one process-wide `AsyncLocalStorageContextManager`, installed on first construction when no other context manager is registered (kept for the process lifetime)
- Service resource attributes (name, version, hostname)

The instance exports its spans through its own provider (`tracer.startSpan(...)` is always routed to this instance). The first `StandardTracer` constructed in a process also registers its provider as the global one, so `trace.getTracer(...)` from `@opentelemetry/api` resolves to it. Later instances do not replace the global provider: they log a warning and keep exporting through their own provider — see [Provider lifecycle](#provider-lifecycle).

```typescript
import { StandardTracer } from "@devopsplaybook.io/otel-utils";

const tracer = new StandardTracer(config);
const span = tracer.startSpan("my-operation");
// ... do work ...
span.end();
```

**Methods:**

- `startSpan(name, parentSpan?, options?)` — Creates a span and returns the SDK `Span` from `@opentelemetry/sdk-trace`. Span names are sanitized to `[a-zA-Z0-9-_/]`. `parentSpan` accepts any API `Span` (for example from `trace.getSpan(context)` or `trace.wrapSpanContext(...)`), so callers need no cast. When neither `parentSpan` nor `options` is given, the span is `SpanKind.INTERNAL` and carries `http.request.method=BACKEND` and a synthetic `http.route` attribute with the value `${serviceName}-${version}-${sanitizedSpanName}`. Passing a `parentSpan`, an `options` object (e.g. `{ kind: SpanKind.SERVER }`), or both forwards them to the OpenTelemetry SDK instead and skips those synthetic attributes, because the caller then describes the span itself. Generic HTTP dashboards that group by `http.request.method`/`http.route` count these spans as `BACKEND` requests with a synthetic route; this is intentional and consumed by otel-light.
- `static updateHttpHeader<T extends object = Record<string, string>>(context, headers?)` — Injects the W3C trace context of `context` into an HTTP headers object for propagation to downstream services, and returns that same object (a new one when omitted). Only `traceparent` and `tracestate` are injected: the propagation context is built from the span alone, so baggage and other active-context values are **not** propagated and an existing `baggage` header is left untouched.
- `shutdown()` — Flushes buffered spans and shuts the tracer provider down. Idempotent.

### StandardLogger

Initializes a `LoggerProvider` with an OTLP log exporter and a `BatchLogRecordProcessor` (`maxQueueSize: 2048`, `maxExportBatchSize: 512`, `exportTimeoutMillis: 30000`, `scheduledDelayMillis: 60000` by default). When `OPENTELEMETRY_COLLECTOR_HTTP_LOGS` is set, the provider is also registered as the global OTel logger provider (first instance only), so `logs.getLogger(...)` from `@opentelemetry/api` returns loggers wired to the configured exporter. Each instance always logs through its own provider (`logger.createModuleLogger(...)`), so a second instance never mis-routes its records to the first one. Without that endpoint, `initOTel` still records the service identity but creates no provider and `getLogger()` returns `undefined`.

```typescript
import { StandardLogger } from "@devopsplaybook.io/otel-utils";

const logger = new StandardLogger();
await logger.initOTel(config);

const moduleLog = logger.createModuleLogger("my-module");
moduleLog.info("Hello world");
```

**Methods:**

- `initOTel(config)` — Initializes the logger provider and optional OTLP exporter, and registers the provider globally when a logs endpoint is configured and no other logger provider is registered. Returns `Promise<void>`: the first call initializes synchronously; await it when re-initializing, because a previous provider is flushed and shut down first.
- `getLogger()` — Returns the underlying OTel `Logger` or `undefined` (also `undefined` after `shutdown()`).
- `createModuleLogger(moduleName)` — Creates a `ModuleLogger` scoped to a module name.
- `shutdown()` — Flushes buffered log records and shuts the logger provider down. Idempotent. No-op when no logs endpoint is configured.

**Batch tunables and loss window**

`BatchLogRecordProcessor` buffers records in memory and exports them periodically:

| Option                 | Config field                                           | Default  |
| ---------------------- | ------------------------------------------------------ | -------- |
| `scheduledDelayMillis` | `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS` | 60000 ms |
| `maxQueueSize`         | `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE`   | 2048     |
| `maxExportBatchSize`   | `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE`   | 512      |
| `exportTimeoutMillis`  | `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS`   | 30000 ms |

A record waits up to `scheduledDelayMillis` (60 s by default) before it is exported; each export sends at most `maxExportBatchSize` (512) records with a 30 s timeout, and at most `maxQueueSize` (2048) records are buffered. Records that arrive while the queue is full are **dropped silently** — no warning or fallback is emitted. A crash or restart loses every record buffered since the last export; call `shutdown()` or use `registerShutdownHooks` (see [Graceful shutdown](#graceful-shutdown)) to flush them. Keep `maxExportBatchSize` ≤ `maxQueueSize` (the SDK clamps it otherwise).

```typescript
await logger.initOTel({
  ...config,
  OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: 5,
  OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE: 4096,
  OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE: 512,
  OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS: 10000,
});
```

### ModuleLogger

Scoped logger that prefixes all output with a module name. Every record carries a `log.module` attribute in addition to the `[module] message` body. Records are emitted to the OTel logger when one is available, and can additionally be mirrored to the console, controlled by `OPENTELEMETRY_CONSOLE_LOG_MODE`:

| Mode               | Behaviour                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `always` (default) | Mirror every record to the console, whether or not OTel logging is configured.             |
| `fallback`         | Mirror only when no OTel logger is configured (`OPENTELEMETRY_COLLECTOR_HTTP_LOGS` unset). |
| `never`            | Never write to the console; records only go to OTel.                                       |

Mirroring is level-aware: `info` uses `console.log`, `warn` uses `console.warn` and `error` uses `console.error` (stderr), so stderr-based alerting sees warnings and errors. An invalid mode value logs one `console.warn` and falls back to `always`. With `never`, a `ModuleLogger` writes nothing to the console even when no OTel logger is configured.

```typescript
const log = logger.createModuleLogger("api");
log.info("request received");
log.warn("rate limit approaching");
log.error("connection failed", new Error("timeout"));
log.error("connection failed", "timeout"); // any unknown value is normalised
log.info("processing complete", activeSpan); // attach trace context
```

**Methods:**

- `info(message, context?)` — Log at INFO level.
- `warn(message, context?)` — Log at WARN level.
- `error(message, error?, context?)` — Log at ERROR level. `error` accepts any value: `Error` instances are kept as-is, strings become `new Error(string)` and other values are serialised with `JSON.stringify` (falling back to `String`). `exception.type` and `exception.message` are always set; `exception.stacktrace` is set only when the error has a stack. `null`/`undefined` add no exception attributes. A `Span` passed as the second argument is treated as the context, so `error("failed", span)` and `error("failed", err, span)` both work.

When a `Span` is passed as `context`, the log record includes `span.id` and `trace.id` attributes for trace correlation.

### StandardMeter

Creates a `MeterProvider` with an optional `PeriodicExportingMetricReader` (`concurrencyLimit: 5`). Provides convenience factories for common metric types. When `OPENTELEMETRY_COLLECTOR_HTTP_METRICS` is set, the provider is registered as the global meter provider (first instance only), so metrics emitted through `metrics.getMeter(...)` reach the configured exporter. Unconfigured meters leave the global API untouched (Noop).

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

**Instrument options**

All four factories accept an optional options argument with the standard OpenTelemetry `MetricOptions` — `description`, `unit`, `valueType` and `advice` — forwarded to the underlying `Meter`. `createObservableGauge` also keeps accepting a description string as its third argument.

These options matter most for histograms: the SDK default bucket boundaries (`[0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]`) are millisecond-oriented. A consumer that records seconds with the defaults puts every value below 5 s into the first bucket, which makes percentiles meaningless. The OpenTelemetry semantic conventions for `http.server.request.duration` therefore expect seconds and these boundaries:

```typescript
const httpDuration = meter.createHistogram("http.server.request.duration", {
  description: "Duration of HTTP server requests",
  unit: "s",
  advice: {
    explicitBucketBoundaries: [
      0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
    ],
  },
});

httpDuration.record(Number(process.hrtime.bigint() - startTime) / 1e9);
```

The other factories accept the same options:

```typescript
meter.createCounter("requests.total", {
  description: "Total requests",
  unit: "1",
});

meter.createObservableGauge(
  "cpu.usage",
  (result) => result.observe(cpuPercent),
  { description: "Current CPU usage", unit: "1" },
);
```

**Metric naming**

- Counters, up-down counters and histograms are exported as `${serviceName}.${key}`.
- A histogram created with `{ unprefixed: true }` is exported exactly as `key`; only histograms have this opt-out.
- Observable gauges are always exported exactly as `key` (never prefixed), including when an options object is passed.

These defaults are unchanged: existing metric names keep working.

**Methods:**

- `createCounter(key, options?)` — Creates a `Counter` named `${serviceName}.${key}`.
- `createUpDownCounter(key, options?)` — Creates an `UpDownCounter` named `${serviceName}.${key}`.
- `createHistogram(key, options?)` — Creates a `Histogram` named `${serviceName}.${key}`; with `{ unprefixed: true }` the histogram is created exactly as `key`, without the service-name prefix. Options also accept the OTel instrument options (`description`, `unit`, `valueType`, `advice`).
- `createObservableGauge(key, callback, descriptionOrOptions?)` — Creates an `ObservableGauge` named `key` with a callback. The third argument is an optional description string or an options object (`description`, `unit`, `valueType`, `advice`).
- `shutdown()` — Flushes buffered metrics and shuts the meter provider down. Idempotent.

## Provider lifecycle

OpenTelemetry's global API accepts one provider per signal per process, and the registration is one-shot until the global API is disabled. `otel-utils` manages this as follows:

- **One provider per signal per process.** The first `StandardTracer`, configured `StandardLogger` and configured `StandardMeter` created in a process each register their provider globally. Global-API calls (`trace.getTracer`, `logs.getLogger`, `metrics.getMeter`) resolve to those first providers until they shut down.
- **Additional instances keep working, locally.** A second instance does not replace the global provider: it logs a `console.warn` and still exports through its own provider, with its own `service.name`/`service.version`. Its records/spans/metrics are never attributed to another service.
- **Re-initialisation.** Calling `StandardLogger.initOTel()` again on the same instance flushes and shuts down the previous provider (its buffered records are exported), then registers the new one as the global provider if possible. Await the returned promise when re-initializing.
- **Shutdown.** `shutdown()` flushes pending telemetry, shuts the provider down and is idempotent. If the instance owns the global provider, it also calls `trace.disable()` / `logs.disable()` / `metrics.disable()`, returning the global API to Noop and allowing a later instance to register again. Shutting down a non-owner leaves the global provider untouched. After `StandardLogger.shutdown()`, `getLogger()` is `undefined`.
- **Context propagation.** One `AsyncLocalStorageContextManager` is installed per process on the first `StandardTracer` construction, only when no other context manager is registered. It stays active for the process lifetime (it is never disabled), so re-initialisation keeps working.

## Graceful shutdown

`StandardTracer`, `StandardLogger` and `StandardMeter` buffer telemetry: `BatchSpanProcessor`, `BatchLogRecordProcessor` and `PeriodicExportingMetricReader` hold data until their next export cycle. On process exit that buffered data would be lost, so flush it on `SIGTERM`/`SIGINT`.

The opt-in `registerShutdownHooks` helper does this for every configured provider and exits the process with code 0 after flushing:

```typescript
import { registerShutdownHooks } from "@devopsplaybook.io/otel-utils";

const cleanup = registerShutdownHooks([tracer, logger, meter]);
// later, if the application manages its own signals:
// cleanup();
```

Register it once, with all configured providers. A second signal received while shutting down does not exit or flush again. The returned function only removes the signal listeners.

For custom flows, `shutdownAll` flushes every provider and always resolves — a failing provider is reported with `console.warn` and does not block the others:

```typescript
import { shutdownAll } from "@devopsplaybook.io/otel-utils";

await shutdownAll([tracer, logger, meter]);
process.exit(0);
```

Each `shutdown()` flushes pending telemetry to the collector before resolving; the methods are idempotent and can be called even when no collector was configured (they resolve immediately).

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

- `@opentelemetry/api` — OpenTelemetry API interfaces
- `@opentelemetry/sdk-trace` — Tracing SDK
- `@opentelemetry/sdk-metrics` — Metrics SDK
- `@opentelemetry/sdk-logs` — Logging SDK
- `@opentelemetry/exporter-trace-otlp-http` / `@opentelemetry/exporter-metrics-otlp-http` / `@opentelemetry/exporter-logs-otlp-http` — OTLP HTTP exporters
- `@opentelemetry/id-generator-aws-xray` — AWS X-Ray trace ID format
- `@opentelemetry/context-async-hooks` — Async context management
- `@opentelemetry/core` — W3C trace context propagation
- `@opentelemetry/resources` / `@opentelemetry/semantic-conventions` — Resource attributes

Dev-only `npm audit` advisories (such as those previously reported in the Jest toolchain via `js-yaml`/`sprintf-js`) are tracked by the regular dependency-update task, not addressed here. The current lockfile reports no vulnerabilities, with or without dev dependencies.

## Build

```bash
npm ci          # install the locked dependencies
npm run build   # tsc → dist/, then type-check the specs
npm run lint    # oxlint + Prettier check
npm test        # Jest unit tests with coverage
```
