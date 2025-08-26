import type { Logger, Logger as OTelLogger } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { ModuleLogger } from "./ModuleLogger";

export class StandardLogger {
  private logger?: Logger;
  private serviceVersion?: string;
  private serviceName?: string;

  public initOTel(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;

    if (config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS) {
      const exporterHeaders: Record<string, string> = {};
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        exporterHeaders[
          "Authorization"
        ] = `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const exporter = new OTLPLogExporter({
        url: config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
        headers: exporterHeaders,
      });

      const loggerProvider = new LoggerProvider({
        processors: [
          new BatchLogRecordProcessor(exporter, {
            maxQueueSize: 100,
            scheduledDelayMillis:
              config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS *
              1000,
          }),
        ],
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: `${this.serviceName}`,
          [ATTR_SERVICE_VERSION]: `${this.serviceVersion}`,
          [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
        }),
      });

      this.logger = loggerProvider.getLogger(
        `${this.serviceName}:${this.serviceVersion}`
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
