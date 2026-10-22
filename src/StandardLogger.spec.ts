import { logs, SeverityNumber } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { StandardLogger } from "./StandardLogger";

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
});
