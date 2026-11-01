import type { Span } from "@opentelemetry/api";
import { SeverityNumber, type Logger as OTelLogger } from "@opentelemetry/api";
import { ModuleLogger, type ModuleLoggerOptions } from "./ModuleLogger";
import type { ConsoleLogMode, LogLevel } from "./models/ConfigOTelInterface";
import type { StandardLoggerInterface } from "./models/StandardLoggerInterface";

interface LoggerState {
  consoleMode?: () => ConsoleLogMode;
  logLevel?: () => LogLevel;
}

describe("ModuleLogger", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let emit: jest.Mock;

  beforeEach(() => {
    emit = jest.fn();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
  });

  function createLogger(
    getLogger: () => OTelLogger | undefined,
    state: LoggerState = {},
  ): StandardLoggerInterface {
    return {
      getLogger,
      getConsoleMode: state.consoleMode ?? (() => "always"),
      getLogLevel: state.logLevel ?? (() => "info"),
    };
  }

  function loggerWithEmit(
    options?: ModuleLoggerOptions,
    state: LoggerState = {},
  ): ModuleLogger {
    const fakeLogger = { emit } as unknown as OTelLogger;
    return new ModuleLogger(
      "billing",
      createLogger(() => fakeLogger, state),
      options,
    );
  }

  function spanWith(spanId: string, traceId: string): Span {
    return {
      spanContext: () => ({ spanId, traceId }),
    } as unknown as Span;
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

  it("appends the error details and stack to the console line", () => {
    const error = new Error("db down");
    loggerWithEmit().error("request failed", error);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      `[error] [billing] request failed — Error: db down\n${error.stack}`,
    );
  });

  it("appends trace and span ids to console lines that carry a span", () => {
    const span = spanWith("span-1", "trace-1");

    loggerWithEmit().error("failed", span);
    expect(errorSpy).toHaveBeenCalledWith(
      "[error] [billing] failed trace.id=trace-1 span.id=span-1",
    );

    loggerWithEmit().info("inside a span", span);
    expect(logSpy).toHaveBeenCalledWith(
      "[info] [billing] inside a span trace.id=trace-1 span.id=span-1",
    );
  });

  it("orders the error suffix, span ids and stack on combined lines", () => {
    const error = new Error("boom");

    loggerWithEmit().error("failed", error, spanWith("span-2", "trace-2"));

    expect(errorSpy).toHaveBeenCalledWith(
      `[error] [billing] failed — Error: boom trace.id=trace-2 span.id=span-2\n${error.stack}`,
    );
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
    loggerWithEmit().error("failed", spanWith("span-1", "trace-1"));

    expect(errorSpy).toHaveBeenCalledWith(
      "[error] [billing] failed trace.id=trace-1 span.id=span-1",
    );
    expect(lastAttributes()).toEqual({
      "log.type": "custom",
      "log.module": "billing",
      "span.id": "span-1",
      "trace.id": "trace-1",
    });
  });

  it("adds span and trace ids when a span context is provided", () => {
    loggerWithEmit().info("inside a span", spanWith("span-1", "trace-1"));

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
    loggerWithEmit().error(
      "failed",
      new Error("boom"),
      spanWith("span-2", "trace-2"),
    );

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

    it("uses the standard logger console mode when no options are given", () => {
      new ModuleLogger(
        "billing",
        createLogger(() => undefined),
      ).info("legacy");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] legacy");
    });

    it("reads the console mode at emit time", () => {
      let mode: ConsoleLogMode = "never";
      const logger = loggerWithEmit(undefined, { consoleMode: () => mode });

      logger.info("silent");
      expect(logSpy).not.toHaveBeenCalled();

      mode = "always";
      logger.info("mirrored");
      expect(logSpy).toHaveBeenCalledWith("[info] [billing] mirrored");
    });

    it("prefers an explicit consoleMode override over the standard logger", () => {
      loggerWithEmit(
        { consoleMode: "always" },
        { consoleMode: () => "never" },
      ).info("forced");

      expect(logSpy).toHaveBeenCalledWith("[info] [billing] forced");
    });
  });

  describe("log levels", () => {
    it("drops debug and trace by default", () => {
      const logger = loggerWithEmit();

      logger.debug("debug-detail");
      logger.trace("trace-detail");

      expect(debugSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it("emits debug through console.debug when the level allows it", () => {
      loggerWithEmit(undefined, { logLevel: () => "debug" }).debug("dbg");

      expect(debugSpy).toHaveBeenCalledWith("[debug] [billing] dbg");
      expect(emit).toHaveBeenCalledWith({
        severityNumber: SeverityNumber.DEBUG,
        severityText: "debug",
        body: "[billing] dbg",
        attributes: { "log.type": "custom", "log.module": "billing" },
      });
    });

    it("emits trace through console.debug when the level allows it", () => {
      loggerWithEmit(undefined, { logLevel: () => "trace" }).trace("trc");

      expect(debugSpy).toHaveBeenCalledWith("[trace] [billing] trc");
      expect(emit).toHaveBeenCalledWith(
        expect.objectContaining({
          severityNumber: SeverityNumber.TRACE,
          severityText: "trace",
          body: "[billing] trc",
        }),
      );
    });

    it("drops info but keeps warn and error at warn level", () => {
      const logger = loggerWithEmit(undefined, { logLevel: () => "warn" });

      logger.info("dropped");
      logger.warn("kept");
      logger.error("kept-error");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith("[warn] [billing] kept");
      expect(errorSpy).toHaveBeenCalledWith("[error] [billing] kept-error");
      expect(emit).toHaveBeenCalledTimes(2);
    });

    it("reads the log level at emit time", () => {
      let level: LogLevel = "info";
      const logger = loggerWithEmit(undefined, { logLevel: () => level });

      logger.debug("dropped");
      expect(emit).not.toHaveBeenCalled();

      level = "debug";
      logger.debug("kept");
      expect(debugSpy).toHaveBeenCalledWith("[debug] [billing] kept");
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });
});
