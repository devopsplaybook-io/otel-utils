import type { Logger } from "@opentelemetry/api";
import type { ConsoleLogMode, LogLevel } from "./ConfigOTelInterface";

export interface StandardLoggerInterface {
  getLogger(): Logger | undefined;
  getConsoleMode(): ConsoleLogMode;
  getLogLevel(): LogLevel;
}
