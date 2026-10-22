import { metrics } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  DataPointType,
  type InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
} from "@opentelemetry/sdk-metrics";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import { StandardMeter } from "./StandardMeter";

jest.mock("@opentelemetry/sdk-metrics", () => {
  const actual = jest.requireActual<
    typeof import("@opentelemetry/sdk-metrics")
  >("@opentelemetry/sdk-metrics");
  const metricReaderOptions: unknown[] = [];
  class RecordingPeriodicExportingMetricReader
    extends actual.PeriodicExportingMetricReader
  {
    constructor(
      options: ConstructorParameters<
        typeof actual.PeriodicExportingMetricReader
      >[0],
    ) {
      super(options);
      metricReaderOptions.push(options);
    }
  }
  return {
    ...actual,
    PeriodicExportingMetricReader: RecordingPeriodicExportingMetricReader,
    __metricReaderOptions: metricReaderOptions,
  };
});

interface SdkMetricsMock {
  __metricReaderOptions: unknown[];
}

function metricReaderOptions(): unknown[] {
  return (jest.requireMock("@opentelemetry/sdk-metrics") as SdkMetricsMock)
    .__metricReaderOptions;
}

jest.mock("@opentelemetry/exporter-metrics-otlp-http", () => {
  const { AggregationTemporality, InMemoryMetricExporter } = jest.requireActual<
    typeof import("@opentelemetry/sdk-metrics")
  >("@opentelemetry/sdk-metrics");
  return {
    OTLPMetricExporter: jest.fn().mockImplementation(function () {
      return new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    }),
  };
});

const mockExporterConstructor = OTLPMetricExporter as unknown as jest.Mock;

function exporterAt(index: number): InMemoryMetricExporter {
  return mockExporterConstructor.mock.results[index]
    .value as InMemoryMetricExporter;
}

function lastExporter(): InMemoryMetricExporter {
  return exporterAt(mockExporterConstructor.mock.results.length - 1);
}

function metricNames(exporter: InMemoryMetricExporter): string[] {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics)
    .map((metric) => metric.descriptor.name);
}

function metricData(
  exporter: InMemoryMetricExporter,
  name: string,
): MetricData | undefined {
  return exporter
    .getMetrics()
    .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
    .flatMap((scopeMetrics) => scopeMetrics.metrics)
    .find((metric) => metric.descriptor.name === name);
}

const SEMCONV_HTTP_DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

function meterConfig(serviceId: string, url?: string): ConfigOTelInterface {
  return {
    SERVICE_ID: serviceId,
    VERSION: "1.0.0",
    OPENTELEMETRY_COLLECTOR_HTTP_METRICS: url,
  };
}

describe("StandardMeter", () => {
  const createdMeters: StandardMeter[] = [];
  let warnSpy: jest.SpyInstance;

  function makeMeter(config: ConfigOTelInterface): StandardMeter {
    const meter = new StandardMeter(config);
    createdMeters.push(meter);
    return meter;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    metricReaderOptions().length = 0;
    metrics.disable();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    for (const meter of createdMeters.splice(0)) {
      await meter.shutdown();
    }
    metrics.disable();
    warnSpy.mockRestore();
  });

  it("builds the metric exporter with URL and concurrency limit and honors the export interval", async () => {
    const meter = makeMeter({
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
    const meter = makeMeter({
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
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector:4318/v1/metrics"),
    );

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

    const exporter = lastExporter();
    expect(metricNames(exporter)).toEqual(
      expect.arrayContaining([
        "metric-service.requests.total",
        "metric-service.users.active",
        "metric-service.requests.latency",
        "cpu.usage",
      ]),
    );
    expect(metricData(exporter, "cpu.usage")?.descriptor.description).toBe(
      "Current CPU usage",
    );
    const counter = metricData(exporter, "metric-service.requests.total");
    expect(counter?.descriptor.unit).toBe("");
    expect(counter?.descriptor.description).toBe("");
  });

  it("records histogram values into the configured semconv seconds buckets", async () => {
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector:4318/v1/metrics"),
    );

    const histogram = meter.createHistogram("http.server.request.duration", {
      description: "Duration of HTTP server requests",
      unit: "s",
      advice: { explicitBucketBoundaries: SEMCONV_HTTP_DURATION_BOUNDARIES },
    });
    for (const seconds of [0.005, 0.042, 0.08, 0.3, 1.2, 4.5]) {
      histogram.record(seconds);
    }

    await meter.shutdown();

    const metric = metricData(
      lastExporter(),
      "metric-service.http.server.request.duration",
    );
    expect(metric).toBeDefined();
    expect(metric?.descriptor.description).toBe(
      "Duration of HTTP server requests",
    );
    expect(metric?.descriptor.unit).toBe("s");
    if (!metric || metric.dataPointType !== DataPointType.HISTOGRAM) {
      throw new Error("expected a histogram metric");
    }
    const [dataPoint] = metric.dataPoints;
    expect(dataPoint.value.count).toBe(6);
    expect(dataPoint.value.buckets.boundaries).toEqual(
      SEMCONV_HTTP_DURATION_BOUNDARIES,
    );
    expect(dataPoint.value.buckets.counts).toEqual([
      1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0,
    ]);
  });

  it("forwards description and unit options for counters and up-down counters", async () => {
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector:4318/v1/metrics"),
    );

    meter
      .createCounter("requests.total", {
        description: "Total requests",
        unit: "1",
      })
      .add(1);
    meter
      .createUpDownCounter("users.active", {
        description: "Active users",
        unit: "{user}",
      })
      .add(1);

    await meter.shutdown();

    const exporter = lastExporter();
    const counter = metricData(exporter, "metric-service.requests.total");
    expect(counter?.descriptor.description).toBe("Total requests");
    expect(counter?.descriptor.unit).toBe("1");
    const upDownCounter = metricData(exporter, "metric-service.users.active");
    expect(upDownCounter?.descriptor.description).toBe("Active users");
    expect(upDownCounter?.descriptor.unit).toBe("{user}");
  });

  it("accepts an options object for observable gauges and keeps them unprefixed", async () => {
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector:4318/v1/metrics"),
    );

    meter.createObservableGauge(
      "cpu.usage",
      (observableResult) => observableResult.observe(0.5),
      { description: "Current CPU usage", unit: "1" },
    );

    await meter.shutdown();

    const exporter = lastExporter();
    const names = metricNames(exporter);
    expect(names).toContain("cpu.usage");
    expect(names).not.toContain("metric-service.cpu.usage");
    const gauge = metricData(exporter, "cpu.usage");
    expect(gauge?.descriptor.description).toBe("Current CPU usage");
    expect(gauge?.descriptor.unit).toBe("1");
  });

  it("creates a histogram without the service-name prefix when the unprefixed option is set", async () => {
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector:4318/v1/metrics"),
    );

    meter.createHistogram("session.duration", { unprefixed: true }).record(1);
    meter.createHistogram("requests.latency").record(42);

    await meter.shutdown();

    const names = metricNames(lastExporter());
    expect(names).toContain("session.duration");
    expect(names).toContain("metric-service.requests.latency");
    expect(names).not.toContain("metric-service.session.duration");
  });

  it("works without a collector, leaves the global API untouched and without a gauge description", async () => {
    const meter = makeMeter(meterConfig("metric-service"));

    expect(mockExporterConstructor).not.toHaveBeenCalled();
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider);
    expect(warnSpy).not.toHaveBeenCalled();

    meter.createCounter("requests.total").add(1);
    const gauge = meter.createObservableGauge("cpu.usage", (observableResult) =>
      observableResult.observe(0.5),
    );
    expect(gauge).toBeDefined();
    await expect(meter.shutdown()).resolves.toBeUndefined();
  });

  it("registers a configured meter as the global provider", async () => {
    const meter = makeMeter(
      meterConfig("metric-service", "http://collector-1/v1/metrics"),
    );

    expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);
    metrics.getMeter("global").createCounter("global.counter").add(1);

    await meter.shutdown();

    expect(metricNames(exporterAt(0))).toContain("global.counter");
  });

  it("keeps each instance on its own exporter and warns on the second registration", async () => {
    const first = makeMeter(
      meterConfig("metric-a", "http://collector-1/v1/metrics"),
    );
    const second = makeMeter(
      meterConfig("metric-b", "http://collector-2/v1/metrics"),
    );

    first.createCounter("a.total").add(1);
    second.createCounter("b.total").add(1);
    metrics.getMeter("global").createCounter("global.counter").add(1);

    await first.shutdown();
    await second.shutdown();

    expect(metricNames(exporterAt(0))).toEqual(
      expect.arrayContaining(["metric-a.a.total", "global.counter"]),
    );
    expect(metricNames(exporterAt(1))).toEqual(["metric-b.b.total"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("A global meter provider is already registered"),
    );
  });

  it("owner shutdown releases the global provider so a new meter can register", async () => {
    const first = makeMeter(
      meterConfig("metric-a", "http://collector-1/v1/metrics"),
    );
    expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);

    await first.shutdown();
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider);

    const second = makeMeter(
      meterConfig("metric-b", "http://collector-2/v1/metrics"),
    );
    expect(metrics.getMeterProvider()).toBeInstanceOf(MeterProvider);
    const shutdownSpy = jest.spyOn(exporterAt(1), "shutdown");

    metrics.getMeter("global").createCounter("after-reinit").add(1);
    await second.shutdown();
    await second.shutdown();

    expect(metricNames(exporterAt(1))).toContain("after-reinit");
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  describe("export interval tuning", () => {
    it("uses the documented default interval", async () => {
      const meter = makeMeter(
        meterConfig("metric-service", "http://collector:4318/v1/metrics"),
      );

      expect(metricReaderOptions()).toHaveLength(1);
      expect(metricReaderOptions()[0]).toEqual({
        exporter: expect.anything(),
        exportIntervalMillis: 60000,
      });
      await meter.shutdown();
    });

    it.each([0, -5, 0.5])(
      "clamps the export interval of %p seconds to one second",
      async (interval) => {
        const meter = makeMeter({
          ...meterConfig("metric-service", "http://collector:4318/v1/metrics"),
          OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS: interval,
        });

        expect(
          (metricReaderOptions()[0] as { exportIntervalMillis: number })
            .exportIntervalMillis,
        ).toBe(1000);
        await meter.shutdown();
      },
    );

    it("falls back to the default interval for a NaN value", async () => {
      const meter = makeMeter({
        ...meterConfig("metric-service", "http://collector:4318/v1/metrics"),
        OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS: NaN,
      });

      expect(
        (metricReaderOptions()[0] as { exportIntervalMillis: number })
          .exportIntervalMillis,
      ).toBe(60000);
      await meter.shutdown();
    });
  });

  describe("service identity validation", () => {
    it("rejects an empty SERVICE_ID without creating an exporter", () => {
      expect(
        () =>
          new StandardMeter({
            SERVICE_ID: "   ",
            VERSION: "1.0.0",
            OPENTELEMETRY_COLLECTOR_HTTP_METRICS:
              "http://collector:4318/v1/metrics",
          }),
      ).toThrow("[otel-utils] SERVICE_ID must be a non-empty string");
      expect(mockExporterConstructor).not.toHaveBeenCalled();
    });

    it("rejects an empty VERSION without creating an exporter", () => {
      expect(
        () =>
          new StandardMeter({
            SERVICE_ID: "metric-service",
            VERSION: "",
            OPENTELEMETRY_COLLECTOR_HTTP_METRICS:
              "http://collector:4318/v1/metrics",
          }),
      ).toThrow("[otel-utils] VERSION must be a non-empty string");
      expect(mockExporterConstructor).not.toHaveBeenCalled();
    });
  });
});
