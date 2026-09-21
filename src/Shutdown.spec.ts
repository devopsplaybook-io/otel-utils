import { StandardLogger } from "./StandardLogger";
import { StandardMeter } from "./StandardMeter";
import { StandardTracer } from "./StandardTracer";
import { ConfigOTelInterface } from "./models/ConfigOTelInterface";

const config: ConfigOTelInterface = {
  SERVICE_ID: "test-service",
  VERSION: "1.0.0",
  OPENTELEMETRY_COLLECTOR_HTTP_TRACES: "",
  OPENTELEMETRY_COLLECTOR_HTTP_METRICS: "",
  OPENTELEMETRY_COLLECTOR_HTTP_LOGS: "",
  OPENTELEMETRY_COLLECTOR_AWS: false,
  OPENTELEMETRY_COLLECTOR_EXPORT_LOGS_INTERVAL_SECONDS: 60,
  OPENTELEMETRY_COLLECTOR_EXPORT_METRICS_INTERVAL_SECONDS: 60,
  OPENTELEMETRY_COLLECT_AUTHORIZATION_HEADER: "",
};

describe("OTel shutdown and forceFlush", () => {
  it("StandardMeter exposes forceFlush and shutdown that resolve", async () => {
    const meter = new StandardMeter(config);
    await expect(meter.forceFlush()).resolves.toBeUndefined();
    await expect(meter.shutdown()).resolves.toBeUndefined();
  });

  it("StandardLogger exposes forceFlush and shutdown that resolve without OTel endpoint", async () => {
    const logger = new StandardLogger();
    await expect(logger.forceFlush()).resolves.toBeUndefined();
    await expect(logger.shutdown()).resolves.toBeUndefined();
  });

  it("StandardLogger flushes and shuts down the provider when initialized", async () => {
    const logger = new StandardLogger();
    logger.initOTel(config);
    await expect(logger.forceFlush()).resolves.toBeUndefined();
    await expect(logger.shutdown()).resolves.toBeUndefined();
  });

  it("StandardTracer exposes forceFlush and shutdown that resolve", async () => {
    const tracer = new StandardTracer(config);
    await expect(tracer.forceFlush()).resolves.toBeUndefined();
    await expect(tracer.shutdown()).resolves.toBeUndefined();
  });
});
