import { SeverityNumber } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";
import type { ConsoleLogMode, LogLevel } from "./models/ConfigOTelInterface";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export interface ModuleLoggerOptions {
  consoleMode?: ConsoleLogMode;
}

const MIN_SEVERITY: Record<LogLevel, SeverityNumber> = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warn: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
};

export class ModuleLogger {
  private module: string;
  private standardLogger: StandardLoggerInterface;
  private consoleModeOverride?: ConsoleLogMode;

  constructor(
    module: string,
    standardLogger: StandardLoggerInterface,
    options: ModuleLoggerOptions = {},
  ) {
    this.module = module;
    this.standardLogger = standardLogger;
    this.consoleModeOverride = options.consoleMode;
  }

  public trace(message: string, context?: Span): void {
    this.display("trace", message, SeverityNumber.TRACE, null, context);
  }

  public debug(message: string, context?: Span): void {
    this.display("debug", message, SeverityNumber.DEBUG, null, context);
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
    if (severityNumber < MIN_SEVERITY[this.standardLogger.getLogLevel()]) {
      return;
    }

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
    const consoleMode =
      this.consoleModeOverride ?? this.standardLogger.getConsoleMode();
    const mirrorToConsole =
      consoleMode === "always" || (consoleMode === "fallback" && !logger);
    if (mirrorToConsole) {
      writeToConsole(
        level,
        this.formatConsoleLine(level, message, error, context),
      );
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

  private formatConsoleLine(
    level: string,
    message: string,
    error: Error | null | undefined,
    context?: Span,
  ): string {
    let line = `[${level}] [${this.module}] ${message}`;
    if (error) {
      line += ` — ${error.name}: ${error.message}`;
    }
    if (context) {
      const spanCtx = context.spanContext();
      line += ` trace.id=${spanCtx.traceId} span.id=${spanCtx.spanId}`;
    }
    if (error?.stack !== undefined) {
      line += `\n${error.stack}`;
    }
    return line;
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
  } else if (level === "debug" || level === "trace") {
    console.debug(line);
  } else {
    console.log(line);
  }
}
