import {
  Counter,
  Histogram,
  Meter,
  metrics,
  type MetricOptions,
  ObservableCounter,
  type ObservableCallback,
  ObservableGauge,
  ObservableUpDownCounter,
  UpDownCounter,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import {
  createOTelResource,
  resolveResourceOptions,
} from "./utils/createResource";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";
import {
  normalizeExportIntervalSeconds,
  normalizePositiveInteger,
  resolveMetricExportTimeout,
  validateServiceIdentity,
} from "./utils/configValidation";
import { buildCollectorExporterOptions } from "./utils/exporterConfig";

let globalMeterProvider: MeterProvider | undefined;

const ALREADY_REGISTERED_WARNING =
  "[otel-utils] A global meter provider is already registered; StandardMeter will not replace it. This instance still records metrics through its own provider, but metrics.getMeter() keeps using the existing provider.";

/**
 * Options accepted by {@link StandardMeter.createHistogram}.
 * `description`, `unit`, `valueType` and `advice` are forwarded to the
 * OpenTelemetry Meter; `advice.explicitBucketBoundaries` sets the histogram
 * bucket boundaries.
 */
export interface StandardMeterCreateHistogramOptions extends MetricOptions {
  /**
   * Create the histogram without the `${serviceName}.` prefix:
   * exported exactly as `key`.
   */
  unprefixed?: boolean;
}

/**
 * Creates instruments through a `MeterProvider` owned by this instance.
 *
 * Single-instance contract: create one `StandardMeter` per process. A second
 * instance keeps working locally (it records through its own provider) but
 * never replaces the global provider registered by the first one.
 * Re-initialisation is only supported by `StandardLogger`; a `StandardMeter`
 * is configured once, in its constructor.
 */
export class StandardMeter {
  private meter: Meter;
  private meterProvider: MeterProvider;
  private serviceVersion: string;
  private serviceName: string;
  private ownsGlobalProvider = false;
  private shutdownPromise?: Promise<void>;

  constructor(config: ConfigOTelInterface) {
    validateServiceIdentity(config);
    this.serviceName = config.SERVICE_ID;
    this.serviceVersion = config.VERSION;
    let hasCollector = false;
    if (config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS) {
      hasCollector = true;
      const metricExporter = new OTLPMetricExporter({
        ...buildCollectorExporterOptions(
          config.OPENTELEMETRY_COLLECTOR_HTTP_METRICS,
          config,
          "OPENTELEMETRY_COLLECTOR_HTTP_METRICS",
        ),
        concurrencyLimit: 5,
      });
      const exportIntervalMillis =
        normalizeExportIntervalSeconds(
          config.OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS,
          60,
        ) * 1000;
      this.meterProvider = new MeterProvider({
        resource: createOTelResource(
          this.serviceName,
          this.serviceVersion,
          resolveResourceOptions(config),
        ),
        readers: [
          new PeriodicExportingMetricReader({
            exporter: metricExporter,
            exportIntervalMillis,
            exportTimeoutMillis: resolveMetricExportTimeout(
              normalizePositiveInteger(
                config.OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_TIMEOUT_MILLIS,
                30000,
              ),
              exportIntervalMillis,
            ),
          }),
        ],
      });
    } else {
      this.meterProvider = new MeterProvider({
        resource: createOTelResource(
          this.serviceName,
          this.serviceVersion,
          resolveResourceOptions(config),
        ),
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

  public forceFlush(): Promise<void> {
    return this.meterProvider.forceFlush();
  }

  /**
   * Returns the underlying OTel `Meter` for advanced instruments. Instruments
   * created through it are not prefixed with the service name.
   */
  public getMeter(): Meter {
    return this.meter;
  }

  public createCounter(key: string, options?: MetricOptions): Counter {
    return this.meter.createCounter(`${this.serviceName}.${key}`, options);
  }

  public createUpDownCounter(
    key: string,
    options?: MetricOptions,
  ): UpDownCounter {
    return this.meter.createUpDownCounter(
      `${this.serviceName}.${key}`,
      options,
    );
  }

  public createHistogram(
    key: string,
    options?: StandardMeterCreateHistogramOptions,
  ): Histogram {
    const { unprefixed, ...instrumentOptions } = options ?? {};
    return this.meter.createHistogram(
      unprefixed ? key : `${this.serviceName}.${key}`,
      instrumentOptions,
    );
  }

  public createObservableCounter(
    key: string,
    callback: ObservableCallback,
    options?: MetricOptions,
  ): ObservableCounter {
    const observableCounter = this.meter.createObservableCounter(
      `${this.serviceName}.${key}`,
      options,
    );
    observableCounter.addCallback(callback);
    return observableCounter;
  }

  public createObservableUpDownCounter(
    key: string,
    callback: ObservableCallback,
    options?: MetricOptions,
  ): ObservableUpDownCounter {
    const observableUpDownCounter = this.meter.createObservableUpDownCounter(
      `${this.serviceName}.${key}`,
      options,
    );
    observableUpDownCounter.addCallback(callback);
    return observableUpDownCounter;
  }

  public createObservableGauge(
    key: string,
    callback: ObservableCallback,
    descriptionOrOptions?: string | MetricOptions,
  ): ObservableGauge {
    const observableGauge = this.meter.createObservableGauge(
      key,
      typeof descriptionOrOptions === "string"
        ? { description: descriptionOrOptions }
        : descriptionOrOptions,
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
