import { SeverityNumber } from "@opentelemetry/api-logs";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";
import { Span } from "@opentelemetry/sdk-trace-base";

export class ModuleLogger {
  private module: string;
  private standardLogger?: StandardLoggerInterface;

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
    context?: Span
  ): void {
    let formattedMessage = message;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes: Record<string, any> = { "log.type": "custom" };

    formattedMessage = message;
    if (error) {
      attributes["exception.type"] = error.name;
      attributes["exception.message"] = error.message;
      attributes["exception.stacktrace"] = error.stack;
      formattedMessage += "\n" + error.stack;
    }

    if (context) {
      const spanCtx = context.spanContext();
      if (spanCtx) {
        attributes["span.id"] = spanCtx.spanId;
        attributes["trace.id"] = spanCtx.traceId;
      }
    }

    console.log(`[${level}] [${this.module}] ${formattedMessage}`);
    if (!this.standardLogger?.getLogger()) {
      return;
    }
    this.standardLogger.getLogger()?.emit({
      severityNumber,
      severityText: level,
      body: `[${this.module}] ${formattedMessage}`,
      attributes,
    });
  }
}
