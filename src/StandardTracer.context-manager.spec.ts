import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { StandardTracer } from "./StandardTracer";

describe("StandardTracer context manager", () => {
  it("warns and keeps an externally registered global context manager", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const external = new AsyncLocalStorageContextManager();
    external.enable();
    try {
      expect(context.setGlobalContextManager(external)).toBe(true);

      const tracer = new StandardTracer({
        SERVICE_ID: "svc",
        VERSION: "1.0.0",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "A global context manager is already registered",
        ),
      );
      await tracer.shutdown();
    } finally {
      context.disable();
      external.disable();
      warnSpy.mockRestore();
    }
  });
});
