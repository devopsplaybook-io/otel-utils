import type { Logger } from "@opentelemetry/api-logs";

export interface StandardLoggerInterface {
  getLogger(): Logger | undefined;
}
