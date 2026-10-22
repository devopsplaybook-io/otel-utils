import type {
  ConfigOTelInterface,
  ConsoleLogMode,
} from "../models/ConfigOTelInterface";

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
