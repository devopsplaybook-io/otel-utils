import { Counter, Histogram, Meter, ObservableGauge } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  ATTR_NETWORK_LOCAL_ADDRESS,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import * as os from "os";
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
        concurrencyLimit: 1,
      };
      if (config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER) {
        collectorOptions.headers[
          "Authorization"
        ] = `Bearer ${config.OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER}`;
      }
      const metricExporter = new OTLPMetricExporter(collectorOptions);
      meterProvider = new MeterProvider({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: `${this.serviceName}`,
          [ATTR_SERVICE_VERSION]: `${this.serviceVersion}`,
          [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
        }),
        readers: [
          new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis:
              config.OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS *
              1000,
          }),
        ],
      });
    } else {
      meterProvider = new MeterProvider({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: `${this.serviceName}`,
          [ATTR_SERVICE_VERSION]: `${this.serviceVersion}`,
          [ATTR_NETWORK_LOCAL_ADDRESS]: os.hostname(),
        }),
      });
    }
    this.meter = meterProvider.getMeter(
      `${this.serviceName}:${this.serviceVersion}`
    );
  }

  public createCounter(key: string): Counter {
    return this.meter.createCounter(`${this.serviceName}.${key}`);
  }

  public createUpDownCounter(key: string): Counter {
    return this.meter.createUpDownCounter(`${this.serviceName}.${key}`);
  }

  public createHistogram(key: string): Histogram {
    return this.meter.createHistogram(`${this.serviceName}.${key}`);
  }

  public createObservableGauge(
    key: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (observableResult: any) => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    description: any = null
  ): ObservableGauge {
    const observableGauge = this.meter.createObservableGauge(key, description);
    observableGauge.addCallback(callback);
    return observableGauge;
  }
}
