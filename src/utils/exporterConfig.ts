import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";
import type { ConfigOTelInterface } from "../models/ConfigOTelInterface";
import {
  normalizeCompression,
  normalizeHeaders,
  normalizePositiveInteger,
  validateCollectorUrl,
} from "./configValidation";

export interface CollectorExporterOptions {
  url: string;
  headers: Record<string, string>;
  timeoutMillis: number;
  compression: CompressionAlgorithm;
}

export function buildCollectorExporterOptions(
  url: string,
  config: ConfigOTelInterface,
  variableName: string,
): CollectorExporterOptions {
  validateCollectorUrl(url, variableName);

  const authorization = config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER;
  if (authorization && new URL(url).protocol === "http:") {
    console.warn(
      `[otel-utils] ${variableName} uses plain HTTP; the bearer token from OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER is sent unencrypted. Prefer an https:// endpoint.`,
    );
  }

  const headers = normalizeHeaders(config.OPENTELEMETRY_COLLECTOR_HTTP_HEADERS);
  if (authorization) {
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === "authorization") {
        delete headers[name];
      }
    }
    headers["Authorization"] = `Bearer ${authorization}`;
  }

  return {
    url,
    headers,
    timeoutMillis: normalizePositiveInteger(
      config.OPENTELEMETRY_COLLECTOR_HTTP_TIMEOUT_MILLIS,
      10000,
    ),
    compression:
      normalizeCompression(config.OPENTELEMETRY_COLLECTOR_HTTP_COMPRESSION) ===
      "gzip"
        ? CompressionAlgorithm.GZIP
        : CompressionAlgorithm.NONE,
  };
}
