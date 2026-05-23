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

export class StandardMeter {
  private meter: Meter;
  private serviceVersion: string;
  private serviceName: string;

  constructor(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    let meterProvider;
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
      meterProvider = new MeterProvider({
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
      meterProvider = new MeterProvider({
        resource: createOTelResource(this.serviceName, this.serviceVersion),
      });
    }
    this.meter = meterProvider.getMeter(
      `${this.serviceName}:${this.serviceVersion}`,
    );
  }

  public createCounter(key: string): Counter {
    return this.meter.createCounter(`${this.serviceName}.${key}`);
  }

  public createUpDownCounter(key: string): UpDownCounter {
    return this.meter.createUpDownCounter(`${this.serviceName}.${key}`);
  }

  public createHistogram(key: string): Histogram {
    return this.meter.createHistogram(`${this.serviceName}.${key}`);
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
