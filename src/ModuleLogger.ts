import { SeverityNumber } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import type { ConsoleLogMode } from "./models/ConfigOTelInterface";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export interface ModuleLoggerOptions {
  consoleMode?: ConsoleLogMode;
}

export class ModuleLogger {
  private module: string;
  private standardLogger: StandardLoggerInterface;
  private consoleMode: ConsoleLogMode;

  constructor(
    module: string,
    standardLogger: StandardLoggerInterface,
    options: ModuleLoggerOptions = {},
  ) {
    this.module = module;
    this.standardLogger = standardLogger;
    this.consoleMode = options.consoleMode ?? "always";
  }

  public info(message: string, context?: Span): void {
    this.display("info", message, SeverityNumber.INFO, null, context);
  }

  public warn(message: string, context?: Span): void {
    this.display("warn", message, SeverityNumber.WARN, null, context);
  }

  public error(message: string, error?: unknown, context?: Span): void {
    if (!context && isSpanLike(error)) {
      context = error;
      error = undefined;
    }
    this.display(
      "error",
      message,
      SeverityNumber.ERROR,
      normalizeError(error),
      context,
    );
  }

  private display(
    level: string,
    message: string,
    severityNumber = SeverityNumber.INFO,
    error?: Error | null,
    context?: Span,
  ): void {
    const attributes: Record<string, string> = {
      "log.type": "custom",
      "log.module": this.module,
    };

    if (error) {
      attributes["exception.type"] = error.name;
      attributes["exception.message"] = error.message;
      if (error.stack !== undefined) {
        attributes["exception.stacktrace"] = error.stack;
      }
    }

    if (context) {
      const spanCtx = context.spanContext();
      attributes["span.id"] = spanCtx.spanId;
      attributes["trace.id"] = spanCtx.traceId;
    }

    const logger = this.standardLogger.getLogger();
    const mirrorToConsole =
      this.consoleMode === "always" ||
      (this.consoleMode === "fallback" && !logger);
    if (mirrorToConsole) {
      writeToConsole(level, `[${level}] [${this.module}] ${message}`);
    }
    if (!logger) {
      return;
    }
    logger.emit({
      severityNumber,
      severityText: level,
      body: `[${this.module}] ${message}`,
      attributes,
    });
  }
}

function normalizeError(value: unknown): Error | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Error) {
    return value;
  }
  return new Error(serializeUnknown(value));
}

function serializeUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) {
      return json;
    }
  } catch {
    // Not serialisable; fall back to String below.
  }
  try {
    return String(value);
  } catch {
    return "Unknown error";
  }
}

function isSpanLike(value: unknown): value is Span {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { spanContext?: unknown }).spanContext === "function"
  );
}

function writeToConsole(level: string, line: string): void {
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
