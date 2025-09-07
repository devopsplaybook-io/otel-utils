import { SeverityNumber } from "@opentelemetry/api-logs";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export class ModuleLogger {
  private module: string;
  private standardLogger?: StandardLoggerInterface;

  constructor(module: string, standardLogger: StandardLoggerInterface) {
    this.module = module;
    this.standardLogger = standardLogger;
  }

<<<<<<< Updated upstream
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public info(message: Error | string | any): void {
    this.display("info", message, SeverityNumber.WARN);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public warn(message: Error | string | any): void {
    this.display("warn", message, SeverityNumber.WARN);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public error(message: Error | string | any): void {
    this.display("error", message, SeverityNumber.ERROR);
=======
  public info(message: string, context?: Span): void {
    this.display("info", message, SeverityNumber.INFO, null, context);
  }

  public warn(message: string, context?: Span): void {
    this.display("warn", message, SeverityNumber.WARN, null, context);
  }

  public error(message: string, error?: Error, context?: Span): void {
    this.display("error", message, SeverityNumber.ERROR, error, context);
>>>>>>> Stashed changes
  }

  private display(
    level: string,
<<<<<<< Updated upstream
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any,
    severityNumber = SeverityNumber.INFO
  ): void {
    if (typeof message === "string") {
      // eslint:disable-next-line:no-console
      console.log(`[${level}] [${this.module}] ${message}`);
    } else if (message instanceof Error) {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${message}`);
      // eslint:disable-next-line:no-console
      console.log((message as Error).stack);
    } else if (typeof message === "object") {
      // eslint:disable-next-line:no-console
      console.log(`${level} [${this.module}] ${JSON.stringify(message)}`);
=======
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
>>>>>>> Stashed changes
    }
    if (!this.standardLogger?.getLogger()) {
      return;
    }
    this.standardLogger.getLogger()?.emit({
      severityNumber,
      severityText: level,
      body: message,
      attributes: { "log.type": "custom" },
    });
  }
}
