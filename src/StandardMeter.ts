import {
  Counter,
  Histogram,
  Meter,
  metrics,
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

let globalMeterProvider: MeterProvider | undefined;

const ALREADY_REGISTERED_WARNING =
  "[otel-utils] A global meter provider is already registered; StandardMeter will not replace it. This instance still records metrics through its own provider, but metrics.getMeter() keeps using the existing provider.";

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
  private ownsGlobalProvider = false;
  private shutdownPromise?: Promise<void>;

  constructor(config: ConfigOTelInterface) {
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    let hasCollector = false;
    if (config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS) {
      hasCollector = true;
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
    if (hasCollector) {
      this.registerGlobalProvider();
    }
  }

  public shutdown(): Promise<void> {
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.doShutdown();
    }
    return this.shutdownPromise;
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

  private registerGlobalProvider(): void {
    if (globalMeterProvider) {
      if (globalMeterProvider === metrics.getMeterProvider()) {
        console.warn(ALREADY_REGISTERED_WARNING);
        return;
      }
      // The previous provider is no longer registered (disabled elsewhere).
      globalMeterProvider = undefined;
    }
    if (metrics.setGlobalMeterProvider(this.meterProvider)) {
      globalMeterProvider = this.meterProvider;
      this.ownsGlobalProvider = true;
    } else {
      console.warn(ALREADY_REGISTERED_WARNING);
    }
  }

  private async doShutdown(): Promise<void> {
    await this.meterProvider.shutdown();
    if (
      this.ownsGlobalProvider &&
      metrics.getMeterProvider() === this.meterProvider
    ) {
      metrics.disable();
    }
    if (globalMeterProvider === this.meterProvider) {
      globalMeterProvider = undefined;
    }
    this.ownsGlobalProvider = false;
  }
}
