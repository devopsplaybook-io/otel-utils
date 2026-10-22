import type { Logger } from "@opentelemetry/api";

export interface StandardLoggerInterface {
  getLogger(): Logger | undefined;
}
