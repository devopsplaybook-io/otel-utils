import type { Logger as OTelLogger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { createOTelResource } from "./utils/createResource";
import { ModuleLogger } from "./ModuleLogger";

import type { StandardLoggerInterface } from "./models/StandardLoggerInterface";

export class StandardLogger implements StandardLoggerInterface {
  private logger?: OTelLogger;
  private serviceVersion?: string;
  private serviceName?: string;

  public initOTel(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;

    if (config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS) {
      const exporterHeaders: Record<string, string> = {};
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        exporterHeaders["Authorization"] =
          `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const exporter = new OTLPLogExporter({
        url: config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
        headers: exporterHeaders,
      });

      const loggerProvider = new LoggerProvider({
        processors: [
          new BatchLogRecordProcessor(exporter, {
            maxQueueSize: 2048,
            scheduledDelayMillis:
              (config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS ??
                60) * 1000,
          }),
        ],
        resource: createOTelResource(this.serviceName, this.serviceVersion),
      });

      this.logger = loggerProvider.getLogger(
        `${this.serviceName}:${this.serviceVersion}`,
      );
    }
  }

  public getLogger(): OTelLogger | undefined {
    return this.logger;
  }

  public createModuleLogger(moduleName: string): ModuleLogger {
    return new ModuleLogger(moduleName, this);
  }
}
