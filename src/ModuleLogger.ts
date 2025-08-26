import { SeverityNumber } from "@opentelemetry/api-logs";
import { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export class ModuleLogger {
  private module: string;
  private standardLogger?: StandardLoggerInterface;

  constructor(module: string, standardLogger: StandardLoggerInterface) {
    this.module = module;
    this.standardLogger = standardLogger;
  }

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
  }

  private display(
    level: string,
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
