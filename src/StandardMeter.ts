import {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  UpDownCounter,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { createOTelResource } from "./utils/createResource";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";

/**
 * Options accepted by {@link StandardMeter.createHistogram}.
 */
export interface StandardMeterCreateHistogramOptions {
  /**
   * Create the histogram without the `${serviceName}.` prefix:
   * exported exactly as `key`.
   */
  unprefixed?: boolean;
}

export class StandardMeter {
  private meter: Meter;
  private meterProvider: MeterProvider;
  private serviceVersion: string;
  private serviceName: string;

  constructor(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    if (config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS) {
      const collectorOptions = {
        url: config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS,
        headers: {} as Record<string, string>,
        concurrencyLimit: 5,
      };
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        collectorOptions.headers["Authorization"] =
          `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const metricExporter = new OTLPMetricExporter(collectorOptions);
      this.meterProvider = new MeterProvider({
        resource: createOTelResource(this.serviceName, this.serviceVersion),
        readers: [
          new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis:
              (config.OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS ??
                60) * 1000,
          }),
        ],
      });
    } else {
      this.meterProvider = new MeterProvider({
        resource: createOTelResource(this.serviceName, this.serviceVersion),
      });
    }
    this.meter = this.meterProvider.getMeter(
      `${this.serviceName}:${this.serviceVersion}`,
    );
  }

  public async shutdown(): Promise<void> {
    await this.meterProvider.shutdown();
  }

  public createCounter(key: string): Counter {
    return this.meter.createCounter(`${this.serviceName}.${key}`);
  }

  public createUpDownCounter(key: string): UpDownCounter {
    return this.meter.createUpDownCounter(`${this.serviceName}.${key}`);
  }

  public createHistogram(
    key: string,
    options?: StandardMeterCreateHistogramOptions,
  ): Histogram {
    return this.meter.createHistogram(
      options?.unprefixed ? key : `${this.serviceName}.${key}`,
    );
  }

  public createObservableGauge(
    key: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (observableResult: any) => void,
    description?: string,
  ): ObservableGauge {
    const observableGauge = this.meter.createObservableGauge(
      key,
      description ? { description } : undefined,
    );
    observableGauge.addCallback(callback);
    return observableGauge;
  }
}
