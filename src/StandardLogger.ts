import { logs, type Logger as OTelLogger } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import type {
  ConfigOTelInterface,
  ConsoleLogMode,
  LogLevel,
} from "./models/ConfigOTelInterface";
import {
  createOTelResource,
  resolveResourceOptions,
} from "./utils/createResource";
import {
  normalizeConsoleLogMode,
  normalizeExportIntervalSeconds,
  normalizeLogLevel,
  normalizePositiveInteger,
  validateServiceIdentity,
} from "./utils/configValidation";
import { ModuleLogger } from "./ModuleLogger";
import { buildCollectorExporterOptions } from "./utils/exporterConfig";

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
  private operationQueue: Promise<void> = Promise.resolve();
  private consoleMode: ConsoleLogMode = "always";
  private logLevel: LogLevel = "info";

  public initOTel(config: ConfigOTelInterface): Promise<void> {
    return this.enqueue(() => this.doInitOTel(config));
  }

  public shutdown(): Promise<void> {
    return this.enqueue(() => this.releaseProvider());
  }

  public forceFlush(): Promise<void> {
    return this.loggerProvider?.forceFlush() ?? Promise.resolve();
  }

  public getLogger(): OTelLogger | undefined {
    return this.logger;
  }

  public getConsoleMode(): ConsoleLogMode {
    return this.consoleMode;
  }

  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public createModuleLogger(moduleName: string): ModuleLogger {
    return new ModuleLogger(moduleName, this);
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async doInitOTel(config: ConfigOTelInterface): Promise<void> {
    // Validate before releasing the previous provider: a bad re-init must keep
    // the working provider in place.
    validateServiceIdentity(config);
    const serviceName = config.SERVICE_ID;
    const serviceVersion = config.VERSION;
    const resource = createOTelResource(
      serviceName,
      serviceVersion,
      resolveResourceOptions(config),
    );
    this.consoleMode = normalizeConsoleLogMode(
      config.OPENTELEMETRY_CONSOLE_LOG_MODE,
    );
    this.logLevel = normalizeLogLevel(config.OPENTELEMETRY_LOG_LEVEL);
    // Build the exporter options before releasing the previous provider: a bad
    // re-init must keep the working provider in place.
    const exporterOptions = config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS
      ? buildCollectorExporterOptions(
          config.OPENTELEMETRY_COLLECTOR_HTTP_LOGS,
          config,
          "OPENTELEMETRY_COLLECTOR_HTTP_LOGS",
        )
      : undefined;
    // Re-initialisation flushes and unregisters the previous provider first.
    if (this.loggerProvider) {
      await this.releaseProvider();
    }
    this.serviceName = serviceName;
    this.serviceVersion = serviceVersion;

    if (!exporterOptions) {
      return;
    }

    const exporter = new OTLPLogExporter(exporterOptions);

    this.loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter,
          maxQueueSize: normalizePositiveInteger(
            config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE,
            2048,
          ),
          maxExportBatchSize: normalizePositiveInteger(
            config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE,
            512,
          ),
          exportTimeoutMillis: normalizePositiveInteger(
            config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS,
            30000,
          ),
          scheduledDelayMillis:
            normalizeExportIntervalSeconds(
              config.OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS,
              60,
            ) * 1000,
        }),
      ],
      resource,
    });

    this.logger = this.loggerProvider.getLogger(
      `${this.serviceName}:${this.serviceVersion}`,
    );
    this.registerGlobalProvider();
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
