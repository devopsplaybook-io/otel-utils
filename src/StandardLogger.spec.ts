import { logs, SeverityNumber } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import type { ConsoleLogMode } from "./models/ConfigOTelInterface";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { StandardLogger } from "./StandardLogger";

jest.mock("@opentelemetry/sdk-logs", () => {
  const actual = jest.requireActual<typeof import("@opentelemetry/sdk-logs")>(
    "@opentelemetry/sdk-logs",
  );
  const batchProcessorOptions: unknown[] = [];
  class RecordingBatchLogRecordProcessor
    extends actual.BatchLogRecordProcessor
  {
    constructor(
      options: ConstructorParameters<typeof actual.BatchLogRecordProcessor>[0],
    ) {
      super(options);
      batchProcessorOptions.push(options);
    }
  }
  return {
    ...actual,
    BatchLogRecordProcessor: RecordingBatchLogRecordProcessor,
    __batchProcessorOptions: batchProcessorOptions,
  };
});

interface SdkLogsMock {
  __batchProcessorOptions: unknown[];
}

function batchProcessorOptions(): unknown[] {
  return (jest.requireMock("@opentelemetry/sdk-logs") as SdkLogsMock)
    .__batchProcessorOptions;
}

jest.mock("@opentelemetry/exporter-logs-otlp-http", () => {
  const { ExportResultCode } = jest.requireActual<
    typeof import("@opentelemetry/core")
  >("@opentelemetry/core");
  return {
    OTLPLogExporter: jest.fn().mockImplementation(function () {
      const exportedRecords: { body?: unknown }[] = [];
      return {
        export: (
          records: { body?: unknown }[],
          resultCallback: (result: { code: number }) => void,
        ) => {
          exportedRecords.push(...records);
          resultCallback({ code: ExportResultCode.SUCCESS });
        },
        forceFlush: jest.fn().mockResolvedValue(undefined),
        shutdown: jest.fn().mockResolvedValue(undefined),
        getExportedRecords: () => exportedRecords,
      };
    }),
  };
});

interface MockLogExporter {
  forceFlush: jest.Mock;
  shutdown: jest.Mock;
  getExportedRecords: () => { body?: unknown }[];
}

const mockExporterConstructor = OTLPLogExporter as unknown as jest.Mock;

function exporterAt(index: number): MockLogExporter {
  return mockExporterConstructor.mock.results[index].value as MockLogExporter;
}

function lastExporter(): MockLogExporter {
  return exporterAt(mockExporterConstructor.mock.results.length - 1);
}

function exportedBodies(exporter: MockLogExporter): unknown[] {
  return exporter.getExportedRecords().map((record) => record.body);
}

function collectorConfig(logsUrl: string): ConfigOTelInterface {
  return {
    SERVICE_ID: "log-service",
    VERSION: "1.0.0",
    OPENTELEMETRY_COLLECTOR_HTTP_LOGS: logsUrl,
  };
}

describe("StandardLogger", () => {
  const createdLoggers: StandardLogger[] = [];
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  function makeLogger(): StandardLogger {
    const logger = new StandardLogger();
    createdLoggers.push(logger);
    return logger;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    batchProcessorOptions().length = 0;
    logs.disable();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const logger of createdLoggers.splice(0)) {
      await logger.shutdown();
    }
    logs.disable();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("builds the log exporter with the collector URL and no auth header", async () => {
    const logger = makeLogger();
    await logger.initOTel(collectorConfig("http://collector:4318/v1/logs"));

    expect(mockExporterConstructor).toHaveBeenCalledTimes(1);
    expect(mockExporterConstructor.mock.calls[0][0]).toEqual({
      url: "http://collector:4318/v1/logs",
      headers: {},
    });
    await logger.shutdown();
  });

  it("adds the Authorization header when configured", async () => {
    const logger = makeLogger();
    await logger.initOTel({
      ...collectorConfig("http://collector:4318/v1/logs"),
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
    });

    expect(mockExporterConstructor.mock.calls[0][0]).toEqual({
      url: "http://collector:4318/v1/logs",
      headers: { Authorization: "Bearer secret" },
    });
    await logger.shutdown();
  });

  it("registers the provider as the global logger provider", async () => {
    const logger = makeLogger();
    await logger.initOTel(collectorConfig("http://collector:4318/v1/logs"));

    expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider);
    await logger.shutdown();
  });

  it("flushes OTel logs and module logger records on shutdown", async () => {
    const logger = makeLogger();
    await logger.initOTel({
      ...collectorConfig("http://collector:4318/v1/logs"),
      OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: 5,
    });

    logs.getLogger("external-lib").emit({
      body: "from-global",
      severityNumber: SeverityNumber.INFO,
    });
    logger.createModuleLogger("billing").info("hello");
    expect(logger.getLogger()).toBeDefined();

    await logger.shutdown();

    expect(exportedBodies(lastExporter())).toEqual(
      expect.arrayContaining(["from-global", "[billing] hello"]),
    );
    expect(lastExporter().shutdown).toHaveBeenCalled();
  });

  it("does not register a global provider without a logs endpoint", async () => {
    const logger = makeLogger();
    await logger.initOTel({ SERVICE_ID: "log-service", VERSION: "1.0.0" });

    expect(logger.getLogger()).toBeUndefined();
    expect(mockExporterConstructor).not.toHaveBeenCalled();
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider);
    await expect(logger.shutdown()).resolves.toBeUndefined();
  });

  it("routes each instance to its own exporter and warns on the second registration", async () => {
    const first = makeLogger();
    const second = makeLogger();
    await first.initOTel(collectorConfig("http://collector-1/v1/logs"));
    await second.initOTel(collectorConfig("http://collector-2/v1/logs"));

    first.createModuleLogger("first").info("from-first");
    second.createModuleLogger("second").info("from-second");
    logs.getLogger("external-lib").emit({
      body: "from-global",
      severityNumber: SeverityNumber.INFO,
    });

    await first.shutdown();
    await second.shutdown();

    expect(exportedBodies(exporterAt(0))).toEqual(
      expect.arrayContaining(["[first] from-first", "from-global"]),
    );
    expect(exportedBodies(exporterAt(1))).toEqual(["[second] from-second"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("A global logger provider is already registered"),
    );
  });

  it("re-initialisation flushes the previous provider and keeps records", async () => {
    const logger = makeLogger();
    await logger.initOTel(collectorConfig("http://collector-1/v1/logs"));
    logger.createModuleLogger("billing").info("before-reinit");

    await logger.initOTel(collectorConfig("http://collector-2/v1/logs"));

    expect(exportedBodies(exporterAt(0))).toContain("[billing] before-reinit");
    expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider);

    logs.getLogger("external-lib").emit({
      body: "after-reinit",
      severityNumber: SeverityNumber.INFO,
    });
    logger.createModuleLogger("billing").info("after-reinit-module");
    await logger.shutdown();

    expect(exportedBodies(exporterAt(1))).toEqual(
      expect.arrayContaining(["after-reinit", "[billing] after-reinit-module"]),
    );
  });

  it("can re-initialise after shutdown", async () => {
    const logger = makeLogger();
    await logger.initOTel(collectorConfig("http://collector/v1/logs"));
    await logger.shutdown();

    expect(logger.getLogger()).toBeUndefined();
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider);

    await logger.initOTel(collectorConfig("http://collector/v1/logs"));
    expect(logger.getLogger()).toBeDefined();
    expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider);

    logs.getLogger("external-lib").emit({
      body: "after-restart",
      severityNumber: SeverityNumber.INFO,
    });
    await logger.shutdown();

    expect(exportedBodies(exporterAt(1))).toContain("after-restart");
  });

  it("shuts down idempotently and leaves the global API on Noop", async () => {
    const logger = makeLogger();
    await logger.initOTel(collectorConfig("http://collector/v1/logs"));
    logger.createModuleLogger("billing").info("recorded");

    await logger.shutdown();
    await logger.shutdown();

    expect(exporterAt(0).shutdown).toHaveBeenCalledTimes(1);
    expect(exportedBodies(exporterAt(0))).toContain("[billing] recorded");
    expect(logger.getLogger()).toBeUndefined();
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider);
    expect(() =>
      logs.getLogger("external-lib").emit({ body: "dropped" }),
    ).not.toThrow();
  });

  describe("batch processor tunables", () => {
    it("passes the documented defaults to BatchLogRecordProcessor", async () => {
      const logger = makeLogger();
      await logger.initOTel(collectorConfig("http://collector/v1/logs"));

      expect(batchProcessorOptions()).toHaveLength(1);
      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        exportTimeoutMillis: 30000,
        scheduledDelayMillis: 60000,
      });
      await logger.shutdown();
    });

    it("passes configured batch values to BatchLogRecordProcessor", async () => {
      const logger = makeLogger();
      await logger.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: 5,
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE: 4096,
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE: 1024,
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS: 15000,
      });

      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        maxQueueSize: 4096,
        maxExportBatchSize: 1024,
        exportTimeoutMillis: 15000,
        scheduledDelayMillis: 5000,
      });
      await logger.shutdown();
    });

    it("falls back to the documented defaults for invalid batch values", async () => {
      const logger = makeLogger();
      await logger.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_QUEUE_SIZE: 0,
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_MAX_BATCH_SIZE: -1,
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_TIMEOUT_MILLIS: 1.5,
      });

      expect(batchProcessorOptions()[0]).toEqual({
        exporter: expect.anything(),
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        exportTimeoutMillis: 30000,
        scheduledDelayMillis: 60000,
      });
      await logger.shutdown();
    });

    it.each([0, -5, 0.5])(
      "clamps the log export interval of %p seconds to one second",
      async (interval) => {
        const logger = makeLogger();
        await logger.initOTel({
          ...collectorConfig("http://collector/v1/logs"),
          OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: interval,
        });

        expect(
          (batchProcessorOptions()[0] as { scheduledDelayMillis: number })
            .scheduledDelayMillis,
        ).toBe(1000);
        await logger.shutdown();
      },
    );

    it("falls back to the default delay for a NaN interval", async () => {
      const logger = makeLogger();
      await logger.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: NaN,
      });

      expect(
        (batchProcessorOptions()[0] as { scheduledDelayMillis: number })
          .scheduledDelayMillis,
      ).toBe(60000);
      await logger.shutdown();
    });
  });

  describe("service identity validation", () => {
    it("rejects an empty SERVICE_ID without creating an exporter", async () => {
      const logger = makeLogger();

      await expect(
        logger.initOTel({
          SERVICE_ID: "   ",
          VERSION: "1.0.0",
          OPENTELEMETRY_COLLECTOR_HTTP_LOGS: "http://collector/v1/logs",
        }),
      ).rejects.toThrow("[otel-utils] SERVICE_ID must be a non-empty string");

      expect(mockExporterConstructor).not.toHaveBeenCalled();
      expect(logger.getLogger()).toBeUndefined();
      await expect(logger.shutdown()).resolves.toBeUndefined();
    });

    it("rejects an empty VERSION without creating an exporter", async () => {
      const logger = makeLogger();

      await expect(
        logger.initOTel({
          SERVICE_ID: "log-service",
          VERSION: "",
          OPENTELEMETRY_COLLECTOR_HTTP_LOGS: "http://collector/v1/logs",
        }),
      ).rejects.toThrow("[otel-utils] VERSION must be a non-empty string");

      expect(mockExporterConstructor).not.toHaveBeenCalled();
      await expect(logger.shutdown()).resolves.toBeUndefined();
    });

    it("keeps the previous provider when a re-initialisation is invalid", async () => {
      const logger = makeLogger();
      await logger.initOTel(collectorConfig("http://collector-1/v1/logs"));
      logger.createModuleLogger("billing").info("before-invalid-reinit");

      await expect(
        logger.initOTel({
          SERVICE_ID: "",
          VERSION: "1.0.0",
          OPENTELEMETRY_COLLECTOR_HTTP_LOGS: "http://collector-2/v1/logs",
        }),
      ).rejects.toThrow("[otel-utils] SERVICE_ID must be a non-empty string");

      expect(logger.getLogger()).toBeDefined();
      expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider);
      logger.createModuleLogger("billing").info("after-invalid-reinit");
      await logger.shutdown();

      expect(mockExporterConstructor).toHaveBeenCalledTimes(1);
      expect(exportedBodies(exporterAt(0))).toEqual(
        expect.arrayContaining([
          "[billing] before-invalid-reinit",
          "[billing] after-invalid-reinit",
        ]),
      );
    });
  });

  describe("console log modes", () => {
    it("mirrors through console.log by default", async () => {
      const logger = makeLogger();
      await logger.initOTel(collectorConfig("http://collector/v1/logs"));

      logger.createModuleLogger("billing").info("mirrored");

      expect(logSpy).toHaveBeenCalledWith("[info] [billing] mirrored");
      await logger.shutdown();
    });

    it("never suppresses console output while records are still exported", async () => {
      const logger = makeLogger();
      await logger.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_CONSOLE_LOG_MODE: "never",
      });

      logger.createModuleLogger("billing").info("silent");

      expect(logSpy).not.toHaveBeenCalled();
      await logger.shutdown();
      expect(exportedBodies(exporterAt(0))).toContain("[billing] silent");
    });

    it("warns once and behaves as always for an invalid mode", async () => {
      const logger = makeLogger();
      await logger.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_CONSOLE_LOG_MODE:
          "sometimes" as unknown as ConsoleLogMode,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("OPENTELEMETRY_CONSOLE_LOG_MODE"),
      );
      logger.createModuleLogger("billing").info("still mirrored");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] still mirrored");
      await logger.shutdown();
    });

    it("fallback mirrors only when no logs endpoint is configured", async () => {
      const withEndpoint = makeLogger();
      await withEndpoint.initOTel({
        ...collectorConfig("http://collector/v1/logs"),
        OPENTELEMETRY_CONSOLE_LOG_MODE: "fallback",
      });
      withEndpoint.createModuleLogger("billing").info("not-mirrored");
      expect(logSpy).not.toHaveBeenCalled();
      await withEndpoint.shutdown();
      expect(exportedBodies(exporterAt(0))).toContain("[billing] not-mirrored");

      const withoutEndpoint = makeLogger();
      await withoutEndpoint.initOTel({
        SERVICE_ID: "log-service",
        VERSION: "1.0.0",
        OPENTELEMETRY_CONSOLE_LOG_MODE: "fallback",
      });
      withoutEndpoint.createModuleLogger("billing").warn("mirrored-fallback");
      expect(warnSpy).toHaveBeenCalledWith(
        "[warn] [billing] mirrored-fallback",
      );
      await withoutEndpoint.shutdown();
    });
  });
});
