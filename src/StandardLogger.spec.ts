import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { LoggerProvider } from "@opentelemetry/sdk-logs";
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

function lastExporter(): MockLogExporter {
  const results = mockExporterConstructor.mock.results;
  return results[results.length - 1].value as MockLogExporter;
}

function collectorConfig(logsUrl: string) {
  return {
    SERVICE_ID: "log-service",
    VERSION: "1.0.0",
    OPENTELEMETRY_COLLECTOR_HTTP_LOGS: logsUrl,
  };
}

describe("StandardLogger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    logs.disable();
  });

  afterEach(() => {
    logs.disable();
  });

  it("builds the log exporter with the collector URL and no auth header", async () => {
    const logger = new StandardLogger();
    logger.initOTel(collectorConfig("http://collector:4318/v1/logs"));

    expect(mockExporterConstructor).toHaveBeenCalledTimes(1);
    expect(mockExporterConstructor.mock.calls[0][0]).toEqual({
      url: "http://collector:4318/v1/logs",
      headers: {},
    });
    await logger.shutdown();
  });

  it("adds the Authorization header when configured", async () => {
    const logger = new StandardLogger();
    logger.initOTel({
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
    const logger = new StandardLogger();
    logger.initOTel(collectorConfig("http://collector:4318/v1/logs"));

    expect(logs.getLoggerProvider()).toBeInstanceOf(LoggerProvider);
    await logger.shutdown();
  });

  it("flushes api-logs and module logger records on shutdown", async () => {
    const logger = new StandardLogger();
    logger.initOTel({
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

    const bodies = lastExporter()
      .getExportedRecords()
      .map((record) => record.body);
    expect(bodies).toEqual(
      expect.arrayContaining(["from-global", "[billing] hello"]),
    );
    expect(lastExporter().shutdown).toHaveBeenCalled();
  });

  it("does not register a global provider without a logs endpoint", async () => {
    const logger = new StandardLogger();
    logger.initOTel({ SERVICE_ID: "log-service", VERSION: "1.0.0" });

    expect(logger.getLogger()).toBeUndefined();
    expect(mockExporterConstructor).not.toHaveBeenCalled();
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider);
    await expect(logger.shutdown()).resolves.toBeUndefined();
  });
});
