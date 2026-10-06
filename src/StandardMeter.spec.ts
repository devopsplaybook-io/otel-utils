import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import type { InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { StandardMeter } from "./StandardMeter";

jest.mock("@opentelemetry/exporter-metrics-otlp-http", () => {
  const {
    AggregationTemporality,
    InMemoryMetricExporter,
  } = jest.requireActual<typeof import("@opentelemetry/sdk-metrics")>(
    "@opentelemetry/sdk-metrics",
  );
  return {
    OTLPMetricExporter: jest.fn().mockImplementation(function () {
      return new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    }),
  };
});

const mockExporterConstructor = OTLPMetricExporter as unknown as jest.Mock;

function lastExporter(): InMemoryMetricExporter {
  const results = mockExporterConstructor.mock.results;
  return results[results.length - 1].value as InMemoryMetricExporter;
}

function metricNames(exporter: InMemoryMetricExporter): string[] {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics)
    .map((metric) => metric.descriptor.name);
}

describe("StandardMeter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds the metric exporter with URL and concurrency limit and honors the export interval", async () => {
    const meter = new StandardMeter({
      SERVICE_ID: "metric-service",
      VERSION: "1.0.0",
      OPENTELEMETRY_COLLECTOR_HTTP_METRICS: "http://collector:4318/v1/metrics",
      OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS: 5,
    });

    expect(mockExporterConstructor).toHaveBeenCalledWith({
      url: "http://collector:4318/v1/metrics",
      headers: {},
      concurrencyLimit: 5,
    });
    await meter.shutdown();
  });

  it("adds the Authorization header when configured", async () => {
    const meter = new StandardMeter({
      SERVICE_ID: "metric-service",
      VERSION: "1.0.0",
      OPENTELEMETRY_COLLECTOR_HTTP_METRICS: "http://collector:4318/v1/metrics",
      OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "secret",
    });

    expect(mockExporterConstructor).toHaveBeenCalledWith({
      url: "http://collector:4318/v1/metrics",
      headers: { Authorization: "Bearer secret" },
      concurrencyLimit: 5,
    });
    await meter.shutdown();
  });

  it("creates the four metric types and flushes them on shutdown", async () => {
    const meter = new StandardMeter({
      SERVICE_ID: "metric-service",
      VERSION: "1.0.0",
      OPENTELEMETRY_COLLECTOR_HTTP_METRICS: "http://collector:4318/v1/metrics",
    });

    meter.createCounter("requests.total").add(1);
    meter.createUpDownCounter("users.active").add(1);
    meter.createHistogram("requests.latency").record(42);
    const gauge = meter.createObservableGauge(
      "cpu.usage",
      (observableResult) => observableResult.observe(0.5),
      "Current CPU usage",
    );
    expect(gauge).toBeDefined();

    await meter.shutdown();

    expect(metricNames(lastExporter())).toEqual(
      expect.arrayContaining([
        "metric-service.requests.total",
        "metric-service.users.active",
        "metric-service.requests.latency",
        "cpu.usage",
      ]),
    );
  });

  it("creates a histogram without the service-name prefix when the unprefixed option is set", async () => {
    const meter = new StandardMeter({
      SERVICE_ID: "metric-service",
      VERSION: "1.0.0",
      OPENTELEMETRY_COLLECTOR_HTTP_METRICS: "http://collector:4318/v1/metrics",
    });

    meter.createHistogram("session.duration", { unprefixed: true }).record(1);
    meter.createHistogram("requests.latency").record(42);

    await meter.shutdown();

    const names = metricNames(lastExporter());
    expect(names).toContain("session.duration");
    expect(names).toContain("metric-service.requests.latency");
    expect(names).not.toContain("metric-service.session.duration");
  });

  it("works without a collector and without a gauge description", async () => {
    const meter = new StandardMeter({
      SERVICE_ID: "metric-service",
      VERSION: "1.0.0",
    });

    expect(mockExporterConstructor).not.toHaveBeenCalled();
    meter.createCounter("requests.total").add(1);
    const gauge = meter.createObservableGauge("cpu.usage", (observableResult) =>
      observableResult.observe(0.5),
    );
    expect(gauge).toBeDefined();
    await expect(meter.shutdown()).resolves.toBeUndefined();
  });
});
