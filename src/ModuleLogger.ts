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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info(message: Error | string | any, context?: Span): void {
    this.display("info", message, SeverityNumber.INFO, context);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public warn(message: Error | string | any, context?: Span): void {
    this.display("warn", message, SeverityNumber.WARN, context);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public error(message: Error | string | any, context?: Span): void {
    this.display("error", message, SeverityNumber.ERROR, context);
  }

  private display(
    level: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: string | Error | any,
    severityNumber = SeverityNumber.INFO,
    context?: Span
  ): void {
    let formattedMessage = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attributes: Record<string, any> = { "log.type": "custom" };

    if (typeof message === "string") {
      formattedMessage = message;
    } else if (message instanceof Error) {
      formattedMessage = message.message;
      attributes["exception.type"] = message.name;
      attributes["exception.message"] = message.message;
      attributes["exception.stacktrace"] = message.stack;
      console.log((message as Error).stack);
    } else if (typeof message === "object") {
      formattedMessage = JSON.stringify(message);
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
