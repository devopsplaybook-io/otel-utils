import { logs, type Logger as OTelLogger } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { createOTelResource } from "./utils/createResource";
import { ModuleLogger } from "./ModuleLogger";

import type { StandardLoggerInterface } from "./models/StandardLoggerInterface";

let globalLoggerProvider: LoggerProvider | undefined;

const ALREADY_REGISTERED_WARNING =
  "[otel-utils] A global logger provider is already registered; StandardLogger will not replace it. This instance still logs through its own provider, but logs.getLogger() keeps using the existing provider.";

export class StandardLogger implements StandardLoggerInterface {
  private logger?: OTelLogger;
  private loggerProvider?: LoggerProvider;
  private serviceVersion?: string;
  private serviceName?: string;
  private ownsGlobalProvider = false;
  private shutdownPromise?: Promise<void>;

  public async initOTel(config: ConfigOTelInterface): Promise<void> {
    // Re-initialisation flushes and unregisters the previous provider first.
    if (this.loggerProvider) {
      await this.releaseProvider();
    }
    this.shutdownPromise = undefined;
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;

    if (!config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS) {
      return;
    }

    const exporterHeaders: Record<string, string> = {};
    if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
      exporterHeaders["Authorization"] =
        `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
    }
    const exporter = new OTLPLogExporter({
      url: config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
      headers: exporterHeaders,
    });

    this.loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter,
          maxQueueSize: 2048,
          scheduledDelayMillis:
            (config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS ??
              60) * 1000,
        }),
      ],
      resource: createOTelResource(this.serviceName, this.serviceVersion),
    });

    this.logger = this.loggerProvider.getLogger(
      `${this.serviceName}:${this.serviceVersion}`,
    );
    this.registerGlobalProvider();
  }

  public shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.releaseProvider();
    }
    return this.shutdownPromise;
  }

  public getLogger(): OTelLogger | undefined {
    return this.logger;
  }

  public createModuleLogger(moduleName: string): ModuleLogger {
    return new ModuleLogger(moduleName, this);
  }

  private registerGlobalProvider(): void {
    if (globalLoggerProvider) {
      if (globalLoggerProvider === logs.getLoggerProvider()) {
        console.warn(ALREADY_REGISTERED_WARNING);
        return;
      }
      // The previous provider is no longer registered (disabled elsewhere).
      globalLoggerProvider = undefined;
    }
    if (
      this.loggerProvider &&
      logs.setGlobalLoggerProvider(this.loggerProvider)
    ) {
      globalLoggerProvider = this.loggerProvider;
      this.ownsGlobalProvider = true;
    } else {
      console.warn(ALREADY_REGISTERED_WARNING);
    }
  }

  private async releaseProvider(): Promise<void> {
    const provider = this.loggerProvider;
    const ownedGlobalProvider = this.ownsGlobalProvider;
    this.logger = undefined;
    this.loggerProvider = undefined;
    this.ownsGlobalProvider = false;
    if (!provider) {
      return;
    }
    await provider.shutdown();
    if (ownedGlobalProvider && logs.getLoggerProvider() === provider) {
      logs.disable();
    }
    if (globalLoggerProvider === provider) {
      globalLoggerProvider = undefined;
    }
  }
}
