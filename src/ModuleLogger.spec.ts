import type { Span } from "@opentelemetry/api";
import {
  SeverityNumber,
  type Logger as OTelLogger,
} from "@opentelemetry/api-logs";
import { ModuleLogger } from "./ModuleLogger";
import type { StandardLoggerInterface } from "./models/StandardLoggerInterface";

describe("ModuleLogger", () => {
  let consoleSpy: jest.SpyInstance;
  let emit: jest.Mock;

  beforeEach(() => {
    emit = jest.fn();
    consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function createLogger(
    getLogger: () => OTelLogger | undefined,
  ): StandardLoggerInterface {
    return { getLogger };
  }

  function loggerWithEmit(): ModuleLogger {
    const fakeLogger = { emit } as unknown as OTelLogger;
    return new ModuleLogger("billing", createLogger(() => fakeLogger));
  }

  it("logs info to console and the OTel logger", () => {
    loggerWithEmit().info("hello");

    expect(consoleSpy).toHaveBeenCalledWith("[info] [billing] hello");
    expect(emit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.INFO,
      severityText: "info",
      body: "[billing] hello",
      attributes: { "log.type": "custom" },
    });
  });

  it("logs warn at WARN severity", () => {
    loggerWithEmit().warn("careful");

    expect(consoleSpy).toHaveBeenCalledWith("[warn] [billing] careful");
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityNumber: SeverityNumber.WARN,
        severityText: "warn",
        body: "[billing] careful",
      }),
    );
  });

  it("logs errors without duplicating the stack in the record body", () => {
    const error = new Error("boom");
    loggerWithEmit().error("request failed", error);

    expect(consoleSpy).toHaveBeenCalledWith("[error] [billing] request failed");
    expect(emit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.ERROR,
      severityText: "error",
      body: "[billing] request failed",
      attributes: {
        "log.type": "custom",
        "exception.type": "Error",
        "exception.message": "boom",
        "exception.stacktrace": error.stack,
      },
    });
  });

  it("adds span and trace ids when a span context is provided", () => {
    const span = {
      spanContext: () => ({ spanId: "span-1", traceId: "trace-1" }),
    } as unknown as Span;

    loggerWithEmit().info("inside a span", span);

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({
          "span.id": "span-1",
          "trace.id": "trace-1",
        }),
      }),
    );
  });

  it("falls back to console only when no OTel logger is available", () => {
    const logger = new ModuleLogger("billing", createLogger(() => undefined));

    logger.warn("offline");

    expect(consoleSpy).toHaveBeenCalledWith("[warn] [billing] offline");
    expect(emit).not.toHaveBeenCalled();
  });
});
