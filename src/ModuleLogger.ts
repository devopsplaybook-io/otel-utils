import { SeverityNumber } from "@opentelemetry/api-logs";
import type { Span } from "@opentelemetry/api";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export class ModuleLogger {
  private module: string;
  private standardLogger: StandardLoggerInterface;

  constructor(module: string, standardLogger: StandardLoggerInterface) {
    this.module = module;
    this.standardLogger = standardLogger;
  }

  public info(message: string, context?: Span): void {
    this.display("info", message, SeverityNumber.INFO, null, context);
  }

  public warn(message: string, context?: Span): void {
    this.display("warn", message, SeverityNumber.WARN, null, context);
  }

  public error(message: string, error?: Error, context?: Span): void {
    this.display("error", message, SeverityNumber.ERROR, error, context);
  }

  private display(
    level: string,
    message: string,
    severityNumber = SeverityNumber.INFO,
    error?: Error | null,
    context?: Span,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes: Record<string, any> = { "log.type": "custom" };

    if (error) {
      attributes["exception.type"] = error.name;
      attributes["exception.message"] = error.message;
      attributes["exception.stacktrace"] = error.stack;
    }

    if (context) {
      const spanCtx = context.spanContext();
      attributes["span.id"] = spanCtx.spanId;
      attributes["trace.id"] = spanCtx.traceId;
    }

    console.log(`[${level}] [${this.module}] ${message}`);
    const logger = this.standardLogger.getLogger();
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
