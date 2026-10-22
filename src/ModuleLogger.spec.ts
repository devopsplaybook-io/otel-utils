import type { Span } from "@opentelemetry/api";
import { SeverityNumber, type Logger as OTelLogger } from "@opentelemetry/api";
import { ModuleLogger, type ModuleLoggerOptions } from "./ModuleLogger";
import type { StandardLoggerInterface } from "./models/StandardLoggerInterface";

describe("ModuleLogger", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let emit: jest.Mock;

  beforeEach(() => {
    emit = jest.fn();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createLogger(
    getLogger: () => OTelLogger | undefined,
  ): StandardLoggerInterface {
    return { getLogger };
  }

  function loggerWithEmit(options?: ModuleLoggerOptions): ModuleLogger {
    const fakeLogger = { emit } as unknown as OTelLogger;
    return new ModuleLogger(
      "billing",
      createLogger(() => fakeLogger),
      options,
    );
  }

  function lastAttributes(): Record<string, unknown> {
    const record = emit.mock.calls[emit.mock.calls.length - 1][0] as {
      attributes: Record<string, unknown>;
    };
    return record.attributes;
  }

  function expectOnlyDefinedAttributes(): void {
    for (const [key, value] of Object.entries(lastAttributes())) {
      expect({ key, defined: value !== undefined }).toEqual({
        key,
        defined: true,
      });
    }
  }

  it("logs info to console.log and the OTel logger with the module attribute", () => {
    loggerWithEmit().info("hello");

    expect(logSpy).toHaveBeenCalledWith("[info] [billing] hello");
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.INFO,
      severityText: "info",
      body: "[billing] hello",
      attributes: { "log.type": "custom", "log.module": "billing" },
    });
  });

  it("mirrors warnings through console.warn", () => {
    loggerWithEmit().warn("careful");

    expect(warnSpy).toHaveBeenCalledWith("[warn] [billing] careful");
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        severityNumber: SeverityNumber.WARN,
        severityText: "warn",
        body: "[billing] careful",
      }),
    );
  });

  it("mirrors errors through console.error", () => {
    loggerWithEmit().error("failed");

    expect(errorSpy).toHaveBeenCalledWith("[error] [billing] failed");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("logs errors without duplicating the stack in the record body", () => {
    const error = new Error("boom");
    loggerWithEmit().error("request failed", error);

    expect(emit).toHaveBeenCalledWith({
      severityNumber: SeverityNumber.ERROR,
      severityText: "error",
      body: "[billing] request failed",
      attributes: {
        "log.type": "custom",
        "log.module": "billing",
        "exception.type": "Error",
        "exception.message": "boom",
        "exception.stacktrace": error.stack,
      },
    });
  });

  it("normalises a string error instead of losing its message", () => {
    loggerWithEmit().error("failed", "string-error");

    const attributes = lastAttributes();
    expect(attributes["exception.type"]).toBe("Error");
    expect(attributes["exception.message"]).toBe("string-error");
    expect(typeof attributes["exception.stacktrace"]).toBe("string");
    expectOnlyDefinedAttributes();
  });

  it("serialises a plain object error", () => {
    loggerWithEmit().error("failed", { code: 42 });

    const attributes = lastAttributes();
    expect(attributes["exception.type"]).toBe("Error");
    expect(attributes["exception.message"]).toBe('{"code":42}');
    expect(typeof attributes["exception.stacktrace"]).toBe("string");
    expectOnlyDefinedAttributes();
  });

  it("adds no exception attributes without an error", () => {
    loggerWithEmit().error("failed");
    expect(lastAttributes()).toEqual({
      "log.type": "custom",
      "log.module": "billing",
    });

    loggerWithEmit().error("failed", null);
    expect(lastAttributes()).toEqual({
      "log.type": "custom",
      "log.module": "billing",
    });
  });

  it("omits exception.stacktrace when the error has no stack", () => {
    const error = new Error("no stack");
    delete error.stack;

    loggerWithEmit().error("failed", error);

    const attributes = lastAttributes();
    expect(attributes["exception.type"]).toBe("Error");
    expect(attributes["exception.message"]).toBe("no stack");
    expect(attributes).not.toHaveProperty("exception.stacktrace");
    expectOnlyDefinedAttributes();
  });

  it("treats a span passed as the second argument as context", () => {
    const span = {
      spanContext: () => ({ spanId: "span-1", traceId: "trace-1" }),
    } as unknown as Span;

    loggerWithEmit().error("failed", span);

    expect(errorSpy).toHaveBeenCalledWith("[error] [billing] failed");
    expect(lastAttributes()).toEqual({
      "log.type": "custom",
      "log.module": "billing",
      "span.id": "span-1",
      "trace.id": "trace-1",
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

  it("combines exception attributes with a span context", () => {
    const span = {
      spanContext: () => ({ spanId: "span-2", traceId: "trace-2" }),
    } as unknown as Span;

    loggerWithEmit().error("failed", new Error("boom"), span);

    const attributes = lastAttributes();
    expect(attributes["exception.message"]).toBe("boom");
    expect(attributes["span.id"]).toBe("span-2");
    expect(attributes["trace.id"]).toBe("trace-2");
    expectOnlyDefinedAttributes();
  });

  describe("console modes", () => {
    it("always mirrors with and without an OTel logger", () => {
      loggerWithEmit({ consoleMode: "always" }).info("with logger");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] with logger");
      expect(emit).toHaveBeenCalledTimes(1);

      const withoutLogger = new ModuleLogger(
        "billing",
        createLogger(() => undefined),
        { consoleMode: "always" },
      );
      withoutLogger.info("without logger");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] without logger");
      expect(emit).toHaveBeenCalledTimes(1);
    });

    it("fallback mirrors only when no OTel logger is available", () => {
      loggerWithEmit({ consoleMode: "fallback" }).info("with logger");
      expect(logSpy).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledTimes(1);

      const withoutLogger = new ModuleLogger(
        "billing",
        createLogger(() => undefined),
        { consoleMode: "fallback" },
      );
      withoutLogger.warn("without logger");
      expect(warnSpy).toHaveBeenCalledWith("[warn] [billing] without logger");
    });

    it("never disables console output while records are still emitted", () => {
      loggerWithEmit({ consoleMode: "never" }).error("silent");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({ severityText: "error" }),
      );
    });

    it("defaults to always when no options are given", () => {
      new ModuleLogger(
        "billing",
        createLogger(() => undefined),
      ).info("legacy");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] legacy");
    });
  });
});
