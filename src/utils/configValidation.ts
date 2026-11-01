import type {
  Compression,
  ConfigOTelInterface,
  ConsoleLogMode,
  LogLevel,
  ResourceAttributeValue,
  TraceSampler,
} from "../models/ConfigOTelInterface";

const DEFAULT_TRACE_SAMPLER: TraceSampler = "parentbased_always_on";

const TRACE_SAMPLERS: readonly TraceSampler[] = [
  "always_on",
  "always_off",
  "traceidratio",
  "parentbased_always_on",
  "parentbased_always_off",
  "parentbased_traceidratio",
];

const RATIO_TRACE_SAMPLERS: readonly TraceSampler[] = [
  "traceidratio",
  "parentbased_traceidratio",
];

export function validateServiceIdentity(
  config: Pick<ConfigOTelInterface, "SERVICE_ID" | "VERSION">,
): void {
  if (
    typeof config.SERVICE_ID !== "string" ||
    config.SERVICE_ID.trim() === ""
  ) {
    throw new Error("[otel-utils] SERVICE_ID must be a non-empty string");
  }
  if (typeof config.VERSION !== "string" || config.VERSION.trim() === "") {
    throw new Error("[otel-utils] VERSION must be a non-empty string");
  }
}

export function resolveTraceSampler(
  samplerValue: unknown,
  ratioValue: unknown,
): { sampler: TraceSampler; ratio: number } {
  const sampler = normalizeTraceSampler(samplerValue);
  if (!RATIO_TRACE_SAMPLERS.includes(sampler)) {
    return { sampler, ratio: 1 };
  }
  return { sampler, ratio: normalizeTraceSamplerRatio(ratioValue) };
}

function normalizeTraceSampler(value: unknown): TraceSampler {
  if (
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return DEFAULT_TRACE_SAMPLER;
  }
  if (TRACE_SAMPLERS.includes(value as TraceSampler)) {
    return value as TraceSampler;
  }
  console.warn(
    `[otel-utils] Invalid OPENTELEMETRY_TRACES_SAMPLER value "${String(value)}"; expected ${TRACE_SAMPLERS.map(
      (sampler) => `"${sampler}"`,
    ).join(", ")}. Defaulting to "${DEFAULT_TRACE_SAMPLER}".`,
  );
  return DEFAULT_TRACE_SAMPLER;
}

function normalizeTraceSamplerRatio(value: unknown): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  ) {
    return value;
  }
  console.warn(
    `[otel-utils] Invalid OPENTELEMETRY_TRACES_SAMPLER_ARG value "${String(value)}"; expected a number between 0 and 1. Defaulting to 1.`,
  );
  return 1;
}

export function normalizeResourceAttributes(
  value: unknown,
): Record<string, ResourceAttributeValue> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      "[otel-utils] OPENTELEMETRY_RESOURCE_ATTRIBUTES must be an object mapping attribute names to string, number or boolean values",
    );
  }
  const attributes: Record<string, ResourceAttributeValue> = {};
  for (const [name, attributeValue] of Object.entries(value)) {
    if (
      typeof attributeValue !== "string" &&
      typeof attributeValue !== "boolean" &&
      !(typeof attributeValue === "number" && Number.isFinite(attributeValue))
    ) {
      throw new Error(
        `[otel-utils] OPENTELEMETRY_RESOURCE_ATTRIBUTES["${name}"] must be a string, number or boolean`,
      );
    }
    attributes[name] = attributeValue;
  }
  return attributes;
}

export function normalizeOptionalIdentityValue(
  value: unknown,
  variableName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`[otel-utils] ${variableName} must be a string when set`);
  }
  if (value.trim() === "") {
    return undefined;
  }
  return value;
}

export function normalizeExportIntervalSeconds(
  value: number | undefined,
  defaultSeconds: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultSeconds;
  }
  return Math.max(1, value);
}

export function normalizePositiveInteger(
  value: number | undefined,
  defaultValue: number,
): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return defaultValue;
  }
  return value;
}

export function normalizeConsoleLogMode(value: unknown): ConsoleLogMode {
  if (value === "always" || value === "fallback" || value === "never") {
    return value;
  }
  if (value !== undefined) {
    console.warn(
      `[otel-utils] Invalid OPENTELEMETRY_CONSOLE_LOG_MODE value "${String(value)}"; expected "always", "fallback" or "never". Defaulting to "always".`,
    );
  }
  return "always";
}

export function validateCollectorUrl(
  value: unknown,
  variableName: string,
): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `[otel-utils] ${variableName} must be a non-empty valid http(s) URL, got "${String(value)}"`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `[otel-utils] ${variableName} must be a valid http(s) URL, got "${value}"`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.hostname === ""
  ) {
    throw new Error(
      `[otel-utils] ${variableName} must be a valid http(s) URL, got "${value}"`,
    );
  }
}

export function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      "[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_HEADERS must be an object mapping header names to strings",
    );
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      throw new Error(
        `[otel-utils] OPENTELEMETRY_COLLECTOR_HTTP_HEADERS["${name}"] must be a string`,
      );
    }
    headers[name] = headerValue;
  }
  return headers;
}

export function normalizeCompression(value: unknown): Compression {
  if (value === "gzip" || value === "none") {
    return value;
  }
  if (value !== undefined) {
    console.warn(
      `[otel-utils] Invalid OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION value "${String(value)}"; expected "gzip" or "none". Defaulting to "none".`,
    );
  }
  return "none";
}

export function resolveMetricExportTimeout(
  timeoutMillis: number,
  intervalMillis: number,
): number {
  if (timeoutMillis <= intervalMillis) {
    return timeoutMillis;
  }
  console.warn(
    `[otel-utils] OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_TIMEOUT_MILLIS (${timeoutMillis} ms) exceeds the metrics export interval (${intervalMillis} ms); clamping the export timeout to ${intervalMillis} ms.`,
  );
  return intervalMillis;
}

export function normalizeLogLevel(value: unknown): LogLevel {
  if (
    value === "trace" ||
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  if (value !== undefined) {
    console.warn(
      `[otel-utils] Invalid OPENTELEMETRY_LOG_LEVEL value "${String(value)}"; expected "trace", "debug", "info", "warn" or "error". Defaulting to "info".`,
    );
  }
  return "info";
}
