# otel-utils

Utility library that simplifies OpenTelemetry integration for Node.js services. Provides standardized tracing, structured logging, and metrics export with minimal boilerplate.

## Installation

```bash
npm install @devopsplaybook.io/otel-utils
```

Requires Node.js 22 or newer (`engines` in `package.json`).

## Configuration

All classes accept a `ConfigOTelInterface` object. The fields mirror environment variables in the consuming application (for example `common-utils`' `ConfigBase`); the library itself does not read `process.env`.

| Field                                                     | Type                                                | Default                 | Description                                               |
| --------------------------------------------------------- | --------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `SERVICE_ID`                                              | `string`                                            | —                       | Service identifier (required, non-empty)                  |
| `VERSION`                                                 | `string`                                            | —                       | Service version (required, non-empty)                     |
| `SERVICE_INSTANCE_ID`                                     | `string?`                                           | —                       | Opt-in `service.instance.id` resource attribute           |
| `DEPLOYMENT_ENVIRONMENT_NAME`                             | `string?`                                           | —                       | Opt-in `deployment.environment.name` resource attribute   |
| `OPENTELEMETRY_RESOURCE_ATTRIBUTES`                       | `Record<string, string \| number \| boolean>?`      | `{}`                    | Extra resource attributes shared by all three signals     |
| `OPENTELEMETRY_TRACES_SAMPLER`                            | `TraceSampler?`                                     | `parentbased_always_on` | Trace sampler — see [Trace sampling](#trace-sampling)     |
| `OPENTELEMETRY_TRACES_SAMPLER_ARG`                        | `number?`                                           | `1`                     | Sample ratio for the `*traceidratio` samplers, in `[0,1]` |
| `OPENTELEMETRY_COLLECTOR_HTTP_TRACES`                     | `string?`                                           | —                       | OTLP HTTP endpoint for traces                             |
| `OPENTELEMETRY_COLLECTOR_HTTP_METRICS`                    | `string?`                                           | —                       | OTLP HTTP endpoint for metrics                            |
| `OPENTELEMETRY_COLLECTOR_HTTP_LOGS`                       | `string?`                                           | —                       | OTLP HTTP endpoint for logs                               |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS`    | `number?`                                           | `60`                    | Log export interval in seconds (clamped to ≥ 1)           |
| `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS` | `number?`                                           | `60`                    | Metrics export interval in seconds (clamped to ≥ 1)       |
| `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS`  | `number?`                                           | `5`                     | Trace export interval in seconds (clamped to ≥ 1)         |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE`      | `number?`                                           | `2048`                  | Max log records buffered before export                    |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE`      | `number?`                                           | `512`                   | Max log records per export batch                          |
| `OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS`      | `number?`                                           | `30000`                 | Log export timeout in milliseconds                        |
| `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_QUEUE_SIZE`    | `number?`                                           | `2048`                  | Max spans buffered before export                          |
| `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_BATCH_SIZE`    | `number?`                                           | `512`                   | Max spans per export batch                                |
| `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_TIMEOUT_MILLIS`    | `number?`                                           | `30000`                 | Trace export timeout in milliseconds                      |
| `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_TIMEOUT_MILLIS`   | `number?`                                           | `30000`                 | Metrics reader export timeout (clamped to the interval)   |
| `OPENTELEMETRY_COLLECTOR_HTTP_HEADERS`                    | `Record<string, string>?`                           | `{}`                    | Extra OTLP HTTP headers for all signals                   |
| `OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS`             | `number?`                                           | `10000`                 | Per-request OTLP HTTP exporter timeout                    |
| `OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION`                | `"gzip" \| "none"`                                  | `"none"`                | OTLP HTTP request compression                             |
| `OPENTELEMETRY_CONSOLE_LOG_MODE`                          | `"always" \| "fallback" \| "never"`                 | `"always"`              | Console mirroring mode for `ModuleLogger`                 |
| `OPENTELEMETRY_LOG_LEVEL`                                 | `"trace" \| "debug" \| "info" \| "warn" \| "error"` | `"info"`                | Minimum level emitted to OTel and mirrored to the console |
| `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER`              | `string?`                                           | —                       | Bearer token for collector auth                           |

`SERVICE_ID` and `VERSION` must be non-empty strings. `StandardTracer`/`StandardMeter` constructors and `StandardLogger.initOTel` fail fast with `[otel-utils] SERVICE_ID must be a non-empty string` / `[otel-utils] VERSION must be a non-empty string` otherwise. A failed re-initialisation of `StandardLogger` keeps the previous provider in place.

`SERVICE_INSTANCE_ID` and `DEPLOYMENT_ENVIRONMENT_NAME` are optional: `undefined` or a blank/whitespace-only string means "unset", any other non-string value throws `[otel-utils] <VARIABLE> must be a string when set`. `OPENTELEMETRY_RESOURCE_ATTRIBUTES` must be an object whose values are strings, finite numbers or booleans; anything else throws an `Error` naming `OPENTELEMETRY_RESOURCE_ATTRIBUTES` and the offending key. An invalid `OPENTELEMETRY_TRACES_SAMPLER` logs one `console.warn` and falls back to `parentbased_always_on`; a missing or invalid `OPENTELEMETRY_TRACES_SAMPLER_ARG` for the ratio samplers logs one `console.warn` and falls back to `1` (see [Trace sampling](#trace-sampling)).

Numeric export intervals below 1 s (including `0` and negative values from an empty environment variable) are clamped to 1 s; `NaN`/`Infinity` fall back to the signal's default (60 s for logs and metrics, 5 s for traces). Non-positive or non-integer batch values fall back to their defaults. The metrics export timeout is clamped to the export interval when it is larger, with one `console.warn` — see [StandardMeter](#standardmeter). An invalid `OPENTELEMETRY_LOG_LEVEL` logs one `console.warn` and falls back to `"info"`; an invalid `OPENTELEMETRY_CONSOLE_LOG_MODE` logs one `console.warn` and falls back to `"always"`; an invalid `OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION` logs one `console.warn` and falls back to `"none"`. Invalid collector URLs and header maps throw an `Error` naming the offending field (see [Exporter HTTP options](#exporter-http-options-all-signals)).

When a collector endpoint is not provided, the corresponding signal (traces, logs, or metrics) is initialized with no export: traces and metrics still have a local provider but no data is sent, and `StandardLogger` creates no provider (its `getLogger()` returns `undefined`).

## Resource identity

`StandardTracer`, `StandardLogger` and `StandardMeter` build the same OpenTelemetry resource, so filtering by service or environment behaves identically across traces, logs and metrics:

| Attribute                     | Source                                            | Default              |
| ----------------------------- | ------------------------------------------------- | -------------------- |
| `service.name`                | `SERVICE_ID`                                      | — (required)         |
| `service.version`             | `VERSION`                                         | — (required)         |
| `network.local.address`       | hostname (`os.hostname()`, cached at module load) | the current hostname |
| `service.instance.id`         | `SERVICE_INSTANCE_ID`                             | unset (opt-in)       |
| `deployment.environment.name` | `DEPLOYMENT_ENVIRONMENT_NAME`                     | unset (opt-in)       |
| any other attribute           | `OPENTELEMETRY_RESOURCE_ATTRIBUTES`               | `{}`                 |

`service.instance.id` and `deployment.environment.name` are stable OpenTelemetry semantic conventions; setting them (for example to the pod name and `production`) materially improves filtering in a shared collector such as otel-light. Both are opt-in: `undefined` or a blank string means the attribute is not set, so the default resource is exactly `service.name` + `service.version` + `network.local.address`.

`OPENTELEMETRY_RESOURCE_ATTRIBUTES` adds any `string | number | boolean` attribute (for example `{ "deployment.tier": "web" }`). **Precedence:** the custom map is applied first; the dedicated identity fields above are applied last and win when set, so a custom map cannot override `service.name`, `service.version`, `network.local.address`, or a configured `service.instance.id`/`deployment.environment.name`. Malformed maps throw an `Error` naming the field and key (see [Configuration](#configuration)).

```typescript
const config = {
  ...baseConfig,
  SERVICE_INSTANCE_ID: process.env.HOSTNAME ?? "local",
  DEPLOYMENT_ENVIRONMENT_NAME: "production",
  OPENTELEMETRY_RESOURCE_ATTRIBUTES: {
    "deployment.tier": "web",
    canary: false,
  },
};
const tracer = new StandardTracer(config);
await logger.initOTel(config);
const meter = new StandardMeter(config);
```

## Exporter HTTP options (all signals)

Traces, logs and metrics share the same OTLP HTTP exporter options:

| Option                                        | Default  | Behaviour                                                                  |
| --------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `OPENTELEMETRY_COLLECTOR_HTTP_HEADERS`        | `{}`     | Extra request headers (`Record<string, string>`) sent to the collector.    |
| `OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS` | `10000`  | Per-request timeout of the OTLP exporter (not the batch export timeout).   |
| `OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION`    | `"none"` | `"gzip"` compresses OTLP request bodies; `"none"` sends them uncompressed. |

**Header precedence:** generic headers from `OPENTELEMETRY_COLLECTOR_HTTP_HEADERS` are applied first; when `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` is set, a bearer `Authorization` header is applied last and wins. Any generic `Authorization`/`authorization` entry is removed first (case-insensitive), so exactly one authorization header is sent. Invalid header maps (not an object, or a non-string value) throw an `Error` naming `OPENTELEMETRY_COLLECTOR_HTTP_HEADERS` and the offending key. An invalid compression value logs one `console.warn` and falls back to `"none"`.

**Endpoint safety:** every configured `OPENTELEMETRY_COLLECTOR_HTTP_*` endpoint is validated when the provider is constructed (for `StandardLogger`, during `initOTel` before the previous provider is released). Malformed URLs and non-`http(s)` protocols (for example `ftp://`) throw `[otel-utils] <VARIABLE> must be a valid http(s) URL, got "..."`, naming the field, instead of failing later at export time. A `http://` endpoint combined with `OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER` logs exactly one `console.warn` per provider initialization explaining that the bearer token is sent in clear text; it does not fail, since plain HTTP may be intentional in a homelab. The token itself is never logged.

```typescript
const tracer = new StandardTracer({
  ...config,
  OPENTELEMETRY_COLLECTOR_HTTP_HEADERS: { "X-Tenant-Id": "acme" },
  OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS: 5000,
  OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION: "gzip",
});
```

## Exported Classes

### StandardTracer

Creates a `TracerProvider` with:

- AWS X-Ray ID generator (`AWSXRayIdGenerator`)
- OTLP HTTP trace exporter (optional, when `OPENTELEMETRY_COLLECTOR_HTTP_TRACES` is set)
- one process-wide `AsyncLocalStorageContextManager`, installed on first construction when no other context manager is registered (kept for the process lifetime)
- the configured trace sampler (default `parentbased_always_on`, the SDK default)
- Service resource attributes (name, version, hostname, plus the opt-in instance id, deployment environment and custom attributes)

The instance exports its spans through its own provider (`tracer.startSpan(...)` is always routed to this instance). The first `StandardTracer` constructed in a process also registers its provider as the global one, so `trace.getTracer(...)` from `@opentelemetry/api` resolves to it. Later instances do not replace the global provider: they log a warning and keep exporting through their own provider — see [Provider lifecycle](#provider-lifecycle).

```typescript
import { StandardTracer } from "@devopsplaybook.io/otel-utils";

const tracer = new StandardTracer(config);
const span = tracer.startSpan("my-operation");
// ... do work ...
span.end();
```

**Methods:**

- `startSpan(name, parentSpan?, options?)` — Creates a span and returns the SDK `Span` from `@opentelemetry/sdk-trace`. Span names are sanitized to `[a-zA-Z0-9-_/]`. `parentSpan` accepts any API `Span` (for example from `trace.getSpan(context)` or `trace.wrapSpanContext(...)`), so callers need no cast. `options` is the full OpenTelemetry API `SpanOptions`: `kind`, `attributes`, `links`, `startTime` and `root`. `links` and `startTime` can only be set at span creation, not afterwards; `attributes` can also be added after creation with `span.setAttribute(...)`. When neither `parentSpan` nor `options` is given, the span is `SpanKind.INTERNAL` and carries `http.request.method=BACKEND` and a synthetic `http.route` attribute with the value `${serviceName}-${version}-${sanitizedSpanName}`. Passing a `parentSpan`, an `options` object (e.g. `{ kind: SpanKind.SERVER }`), or both forwards them to the OpenTelemetry SDK instead and skips those synthetic attributes, because the caller then describes the span itself. Generic HTTP dashboards that group by `http.request.method`/`http.route` count these spans as `BACKEND` requests with a synthetic route; this is intentional and consumed by otel-light.
- `static updateHttpHeader<T extends object = Record<string, string>>(context, headers?)` — Injects the W3C trace context of `context` into an HTTP headers object for propagation to downstream services, and returns that same object (a new one when omitted). Only `traceparent` and `tracestate` are injected: the propagation context is built from the span alone, so baggage and other active-context values are **not** propagated and an existing `baggage` header is left untouched.
- `shutdown()` — Flushes buffered spans and shuts the tracer provider down. Idempotent.
- `forceFlush()` — Flushes buffered spans to the collector without shutting the provider down; resolves immediately when no collector is configured. Use it at checkpoints in short-lived jobs and serverless handlers.

```typescript
import { SpanKind } from "@opentelemetry/api";

const span = tracer.startSpan("checkout", undefined, {
  kind: SpanKind.CLIENT,
  attributes: { "checkout.channel": "web" },
  links: [{ context: upstreamSpan.spanContext() }],
  startTime: new Date(Date.now() - 250),
});
span.setAttribute("checkout.items", 3); // attributes can also be added afterwards
span.end();
```

#### Trace sampling

`OPENTELEMETRY_TRACES_SAMPLER` selects the SDK sampler used by the tracer provider. The default `parentbased_always_on` is the SDK default: root spans are always sampled and children follow their parent.

| Value                      | SDK sampler                                            |
| -------------------------- | ------------------------------------------------------ |
| `always_on`                | `AlwaysOnSampler`                                      |
| `always_off`               | `AlwaysOffSampler`                                     |
| `traceidratio`             | `TraceIdRatioBasedSampler`                             |
| `parentbased_always_on`    | `ParentBasedSampler` (root `AlwaysOnSampler`)          |
| `parentbased_always_off`   | `ParentBasedSampler` (root `AlwaysOffSampler`)         |
| `parentbased_traceidratio` | `ParentBasedSampler` (root `TraceIdRatioBasedSampler`) |

`OPENTELEMETRY_TRACES_SAMPLER_ARG` is the sampling ratio in `[0,1]` and is only used by `traceidratio` and `parentbased_traceidratio`; `0` samples nothing and `1` samples everything. It is ignored by the other samplers. An invalid sampler value logs one `console.warn` and falls back to `parentbased_always_on`; a missing or invalid ratio logs one `console.warn` and falls back to `1`.

```typescript
const tracer = new StandardTracer({
  ...config,
  OPENTELEMETRY_TRACES_SAMPLER: "parentbased_traceidratio",
  OPENTELEMETRY_TRACES_SAMPLER_ARG: 0.1, // sample 10% of root traces
});
```

**Trace batch tunables and loss window**

When a traces endpoint is configured, spans flow through a `BatchSpanProcessor`. It buffers spans in memory and exports them periodically:

| Option                 | Config field                                             | Default  |
| ---------------------- | -------------------------------------------------------- | -------- |
| `scheduledDelayMillis` | `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS` | 5000 ms  |
| `maxQueueSize`         | `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_QUEUE_SIZE`   | 2048     |
| `maxExportBatchSize`   | `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_BATCH_SIZE`   | 512      |
| `exportTimeoutMillis`  | `OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_TIMEOUT_MILLIS`   | 30000 ms |

A span waits up to `scheduledDelayMillis` (5 s by default) before it is exported; each export sends at most `maxExportBatchSize` (512) spans with a 30 s timeout, and at most `maxQueueSize` (2048) spans are buffered. Spans that arrive while the queue is full are **dropped silently** — `BatchSpanProcessor` reports drops only through the OpenTelemetry `diag` logger, which is disabled by default. A crash or restart loses every span buffered since the last export; call `shutdown()` or use `registerShutdownHooks` (see [Graceful shutdown](#graceful-shutdown)) to flush them. Keep `maxExportBatchSize` ≤ `maxQueueSize` (the SDK clamps it otherwise).

```typescript
const tracer = new StandardTracer({
  ...config,
  OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_INTERVAL_SECONDS: 2,
  OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_QUEUE_SIZE: 4096,
  OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_MAX_BATCH_SIZE: 1024,
  OPENTELEMETRY_COLLECTOR_EXPORT_TRACES_TIMEOUT_MILLIS: 10000,
});
```

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

- `initOTel(config)` — Initializes the logger provider and optional OTLP exporter, and registers the provider globally when a logs endpoint is configured and no other logger provider is registered. Returns `Promise<void>`; a previous provider is flushed and shut down first. Queued in call order with `shutdown()` — see [Provider lifecycle](#provider-lifecycle).
- `getLogger()` — Returns the underlying OTel `Logger` or `undefined` (also `undefined` after `shutdown()`).
- `getConsoleMode()` — Returns the current console mirroring mode (`always` by default).
- `getLogLevel()` — Returns the current minimum log level (`info` by default).
- `createModuleLogger(moduleName)` — Creates a `ModuleLogger` scoped to a module name. The logger reads `getConsoleMode()` and `getLogLevel()` at emit time, so it follows the configured mode and level even when it is created before `initOTel()`, and a re-initialisation changes the behaviour of existing loggers.
- `shutdown()` — Flushes buffered log records and shuts the logger provider down. Idempotent. No-op when no logs endpoint is configured. Queued in call order with `initOTel()`.
- `forceFlush()` — Flushes buffered log records to the collector without shutting the provider down; resolves immediately when no logger provider exists. Use it at checkpoints in short-lived jobs and serverless handlers.

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

Scoped logger that prefixes all output with a module name. Every record carries a `log.module` attribute in addition to the `[module] message` body. Records are emitted to the OTel logger when one is available, filtered by `OPENTELEMETRY_LOG_LEVEL`, and can additionally be mirrored to the console, controlled by `OPENTELEMETRY_CONSOLE_LOG_MODE`:

| Mode               | Behaviour                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `always` (default) | Mirror every record to the console, whether or not OTel logging is configured.             |
| `fallback`         | Mirror only when no OTel logger is configured (`OPENTELEMETRY_COLLECTOR_HTTP_LOGS` unset). |
| `never`            | Never write to the console; records only go to OTel.                                       |

The console mode is read when a record is emitted, not when the logger is created: a `ModuleLogger` created before `initOTel()` follows the configured mode after initialisation, and re-initialising with a different mode changes the behaviour of existing loggers. `createModuleLogger()` does not snapshot the mode; passing `{ consoleMode }` to `new ModuleLogger(module, standardLogger, options)` overrides it explicitly for tests and advanced use.

Mirroring is level-aware: `info` uses `console.log`, `warn` uses `console.warn`, `error` uses `console.error` (stderr), and `debug`/`trace` use `console.debug`. An invalid mode value logs one `console.warn` and falls back to `always`. With `never`, a `ModuleLogger` writes nothing to the console even when no OTel logger is configured.

Console lines carry the actionable details: `[<level>] [<module>] <message>`, followed by ` — <error.name>: <error.message>` when an error is attached and ` trace.id=<traceId> span.id=<spanId>` when a span is passed as context. The stack follows on a new line inside the same console call. For example, `log.error("request failed", error, span)` writes `[error] [api] request failed — Error: db down trace.id=… span.id=…` followed by the stack. The OTel record is unchanged (`[<module>] <message>` body plus `exception.*`, `trace.id` and `span.id` attributes); only the console line gains these details. The configured authorization token is never written to the console.

`OPENTELEMETRY_LOG_LEVEL` sets the minimum level for **both** OTel emission and console mirroring. The default `info` keeps the existing output and drops only the new `debug` and `trace` records; `trace` lets every level through, `warn` drops `info` and below, and `error` emits only errors. An invalid value logs one `console.warn` and falls back to `info`.

**Container deployments:** `always` duplicates log volume — every record is written to stdout/stderr _and_ exported over OTLP, so with stdout collection the same log is stored twice. When a containerized service's stdout is collected, use `fallback`: the console then receives records only when no OTLP logs endpoint is configured (`OPENTELEMETRY_COLLECTOR_HTTP_LOGS` unset). The `always` default is unchanged.

```typescript
const log = logger.createModuleLogger("api");
log.trace("entering handler"); // filtered at the default info level
log.debug("resolved tenant", activeSpan); // filtered at the default info level
log.info("request received");
log.warn("rate limit approaching");
log.error("connection failed", new Error("timeout"));
log.error("connection failed", "timeout"); // any unknown value is normalised
log.info("processing complete", activeSpan); // attach trace context
```

**Methods:**

- `trace(message, context?)` — Log at TRACE level; mirrored through `console.debug`.
- `debug(message, context?)` — Log at DEBUG level; mirrored through `console.debug`.
- `info(message, context?)` — Log at INFO level.
- `warn(message, context?)` — Log at WARN level.
- `error(message, error?, context?)` — Log at ERROR level. `error` accepts any value: `Error` instances are kept as-is, strings become `new Error(string)` and other values are serialised with `JSON.stringify` (falling back to `String`). `exception.type` and `exception.message` are always set; `exception.stacktrace` is set only when the error has a stack. `null`/`undefined` add no exception attributes. A `Span` passed as the second argument is treated as the context, so `error("failed", span)` and `error("failed", err, span)` both work.

When a `Span` is passed as `context`, the log record includes `span.id` and `trace.id` attributes for trace correlation, and the console line appends `trace.id=… span.id=…`.

### StandardMeter

Creates a `MeterProvider` with an optional `PeriodicExportingMetricReader` (`concurrencyLimit: 5`). Provides convenience factories for common metric types. When `OPENTELEMETRY_COLLECTOR_HTTP_METRICS` is set, the provider is registered as the global meter provider (first instance only), so metrics emitted through `metrics.getMeter(...)` reach the configured exporter. Unconfigured meters leave the global API untouched (Noop).

**Metric reader tunables**

| Option                 | Config field                                              | Default  |
| ---------------------- | --------------------------------------------------------- | -------- |
| `exportIntervalMillis` | `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS` | 60000 ms |
| `exportTimeoutMillis`  | `OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_TIMEOUT_MILLIS`   | 30000 ms |

Each export is cancelled after `exportTimeoutMillis`. When the configured timeout exceeds the export interval, it is clamped to the interval and one `console.warn` explains the effective value (`PeriodicExportingMetricReader` requires timeout ≤ interval). For example, a 5 s interval with the default 30 s timeout exports with a 5 s timeout and warns once at startup. The default 60 s interval and 30 s timeout are compatible and warning-free.

```typescript
const meter = new StandardMeter({
  ...config,
  OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS: 15,
  OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_TIMEOUT_MILLIS: 10000,
});
```

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

const queueProcessed = meter.createObservableCounter(
  "queue.processed",
  (result) => result.observe(processedJobs),
  { description: "Processed jobs", unit: "1" },
);

const queueDepth = meter.createObservableUpDownCounter(
  "queue.depth",
  (result) => result.observe(backlogSize),
  { description: "Queue backlog", unit: "{item}" },
);
```

**Instrument options**

All factories accept an optional options argument with the standard OpenTelemetry `MetricOptions` — `description`, `unit`, `valueType` and `advice` — forwarded to the underlying `Meter`. `createObservableGauge` also keeps accepting a description string as its third argument.

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

- Counters, up-down counters, histograms, observable counters and observable up-down counters are exported as `${serviceName}.${key}`.
- A histogram created with `{ unprefixed: true }` is exported exactly as `key`; only histograms have this opt-out.
- Observable gauges are always exported exactly as `key` (never prefixed), including when an options object is passed.
- Instruments created through `getMeter()` are exported exactly as named; that raw accessor never prefixes.

These defaults are unchanged: existing metric names keep working.

**Methods:**

- `createCounter(key, options?)` — Creates a `Counter` named `${serviceName}.${key}`.
- `createUpDownCounter(key, options?)` — Creates an `UpDownCounter` named `${serviceName}.${key}`.
- `createHistogram(key, options?)` — Creates a `Histogram` named `${serviceName}.${key}`; with `{ unprefixed: true }` the histogram is created exactly as `key`, without the service-name prefix. Options also accept the OTel instrument options (`description`, `unit`, `valueType`, `advice`).
- `createObservableGauge(key, callback, descriptionOrOptions?)` — Creates an `ObservableGauge` named `key` with a callback. The third argument is an optional description string or an options object (`description`, `unit`, `valueType`, `advice`).
- `createObservableCounter(key, callback, options?)` — Creates an `ObservableCounter` named `${serviceName}.${key}` with a callback, for monotonically increasing asynchronous values (for example processed jobs). `callback` is `(observableResult) => void`; the instrument options are forwarded.
- `createObservableUpDownCounter(key, callback, options?)` — Creates an `ObservableUpDownCounter` named `${serviceName}.${key}` with a callback, for values that can increase or decrease (for example queue/backlog sizes). `callback` is `(observableResult) => void`; the instrument options are forwarded.
- `getMeter()` — Returns the underlying OTel `Meter` for advanced instruments. Instruments created through it are exported exactly as named, without the `${serviceName}.` prefix.
- `shutdown()` — Flushes buffered metrics and shuts the meter provider down. Idempotent.
- `forceFlush()` — Flushes buffered metrics to the collector without shutting the meter provider down; resolves immediately when no collector is configured. Use it at checkpoints in short-lived jobs and serverless handlers.

## Provider lifecycle

OpenTelemetry's global API accepts one provider per signal per process, and the registration is one-shot until the global API is disabled. `otel-utils` manages this as follows:

- **One provider per signal per process.** The first `StandardTracer`, configured `StandardLogger` and configured `StandardMeter` created in a process each register their provider globally. Global-API calls (`trace.getTracer`, `logs.getLogger`, `metrics.getMeter`) resolve to those first providers until they shut down.
- **Additional instances keep working, locally.** A second instance does not replace the global provider: it logs a `console.warn` and still exports through its own provider, with its own `service.name`/`service.version`. Its records/spans/metrics are never attributed to another service.
- **Re-initialisation.** Calling `StandardLogger.initOTel()` again on the same instance flushes and shuts down the previous provider (its buffered records are exported), then registers the new one as the global provider if possible. Await the returned promise when re-initializing.
- **Single-instance contract for tracer and meter.** `StandardTracer` and `StandardMeter` are configured once, in their constructor; they have no re-initialisation method. Create one per process. A second instance keeps working locally but never replaces the global provider — only `StandardLogger` supports re-initialisation.
- **Serialised init/shutdown (`StandardLogger`).** `initOTel()` and `shutdown()` run through one promise queue, in call order, and never interleave. An init queued while a shutdown is in flight waits for it, then creates and registers its provider; a shutdown queued behind an init shuts the provider created by that init. The queue survives validation failures (only the failing operation rejects), and `forceFlush()` is non-terminal: it never changes the lifecycle state or the global registration.
- **Shutdown.** `shutdown()` flushes pending telemetry, shuts the provider down and is idempotent. If the instance owns the global provider, it also calls `trace.disable()` / `logs.disable()` / `metrics.disable()`, returning the global API to Noop and allowing a later instance to register again. Shutting down a non-owner leaves the global provider untouched. After `StandardLogger.shutdown()`, `getLogger()` is `undefined`.
- **Context propagation.** One `AsyncLocalStorageContextManager` is installed per process on the first `StandardTracer` construction, only when no other context manager is registered. It stays active for the process lifetime (it is never disabled), so re-initialisation keeps working.

## Graceful shutdown

`StandardTracer`, `StandardLogger` and `StandardMeter` buffer telemetry: `BatchSpanProcessor`, `BatchLogRecordProcessor` and `PeriodicExportingMetricReader` hold data until their next export cycle. On process exit that buffered data would be lost, so flush it on `SIGTERM`/`SIGINT`.

The opt-in `registerShutdownHooks` helper does this for every configured provider and, by default, exits the process with code 0 once the flush completes or times out:

```typescript
import { registerShutdownHooks } from "@devopsplaybook.io/otel-utils";

const cleanup = registerShutdownHooks([tracer, logger, meter], {
  signals: ["SIGTERM", "SIGINT"], // default
  timeoutMillis: 10_000, // default
  exit: true, // default
});
// later, if the application manages its own signals:
// cleanup();
```

Options:

- `signals` — signals to listen to, default `["SIGTERM", "SIGINT"]`; duplicates are removed. It replaces the defaults rather than extending them.
- `timeoutMillis` — upper bound of the flush, default 10 000 ms; non-integer or non-positive values fall back to the default. Keep it below the container's `terminationGracePeriodSeconds` (30 s by default in Kubernetes) and consistent with the providers' export timeouts (30 s SDK default), otherwise the pod is SIGKILLed mid-flush. When it elapses, one `[otel-utils] shutdown timed out after ...` warning is logged and the process continues (or exits with code 0) without waiting for the remaining providers.
- `exit` — `true` (default) exits with code 0 after the flush or timeout; `false` only flushes and never calls `process.exit`, for applications that own HTTP draining and database shutdown.

Signal semantics:

- Handlers use `process.on`, not `process.once`. The first signal starts one shutdown; any later `SIGTERM`/`SIGINT` (the same one or the other) is ignored while it runs — no re-flush and no early termination, even when the flush is slow.
- The listeners are removed when the flush completes (and by the returned cleanup function), so the process regains Node's default signal behaviour. `cleanup()` is idempotent, does not cancel an in-flight flush and removes only the listeners this call registered.

Choose the helper that matches who owns the shutdown:

- `registerShutdownHooks(providers)` — the library owns the signals and the process exit.
- `registerShutdownHooks(providers, { exit: false })` — the application owns the shutdown sequence (drain HTTP, close the database, then exit) and uses the helper as one bounded telemetry-flush step; combine it with the returned `cleanup()`.
- `shutdownAll(providers)` — a fully custom flow: it flushes every provider, has no timeout, always resolves (a failing provider is reported with `console.warn` and does not block the others) and never calls `process.exit`:

```typescript
import { shutdownAll } from "@devopsplaybook.io/otel-utils";

await shutdownAll([tracer, logger, meter]);
process.exit(0);
```

To flush without shutting anything down or exiting — at a checkpoint in a short-lived job or a serverless handler — call `forceFlush()` on the tracer, logger or meter.

Each `shutdown()` flushes pending telemetry to the collector before resolving; the methods are idempotent and can be called even when no collector was configured (they resolve immediately).

## Internal Utilities

### createOTelResource

Shared internal utility that creates an `OTelResource` with `service.name`, `service.version` and `network.local.address` (hostname), plus the optional `service.instance.id`, `deployment.environment.name` and custom resource attributes. The hostname is cached at module load time to minimize system calls. The same resource is used by `StandardTracer`, `StandardLogger` and `StandardMeter`.

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

All three signals share the same service identity (name + version), the optional instance id and deployment environment, and any custom resource attributes via `createOTelResource`. Export is optional per signal — only configured when the corresponding `OPENTELEMETRY_COLLECTOR_HTTP_*` endpoint is set.

## Dependencies

- `@opentelemetry/api` — OpenTelemetry API interfaces
- `@opentelemetry/sdk-trace` — Tracing SDK
- `@opentelemetry/sdk-metrics` — Metrics SDK
- `@opentelemetry/sdk-logs` — Logging SDK
- `@opentelemetry/exporter-trace-otlp-http` / `@opentelemetry/exporter-metrics-otlp-http` / `@opentelemetry/exporter-logs-otlp-http` — OTLP HTTP exporters
- `@opentelemetry/id-generator-aws-xray` — AWS X-Ray trace ID format
- `@opentelemetry/otlp-exporter-base` — OTLP exporter compression option
- `@opentelemetry/context-async-hooks` — Async context management
- `@opentelemetry/core` — W3C trace context propagation
- `@opentelemetry/resources` / `@opentelemetry/semantic-conventions` — Resource attributes

Runtime dependencies are clean: `npm audit --omit=dev` reports no vulnerabilities. The full `npm audit` still reports 19 dev-only advisories in the Jest toolchain (`deepmerge`, `glob`, `minimatch`, `test-exclude` and Jest packages); they are tracked by the regular dependency-update task, not addressed here.

## Build

```bash
npm ci          # install the locked dependencies
npm run build   # tsc → dist/, then type-check the specs
npm run lint    # oxlint + Prettier check
npm test        # Jest unit tests; enforces the coverage thresholds in jest.config.js
```

`npm pack --dry-run` lists the published files (`LICENSE`, `README.md`, `package.json` and `dist/**`); the `prepack` script builds `dist` first, so the tarball always contains a fresh build.
