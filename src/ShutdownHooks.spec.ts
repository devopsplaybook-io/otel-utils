import { registerShutdownHooks, shutdownAll } from "./ShutdownHooks";

describe("shutdownAll", () => {
  it("shuts down every provider", async () => {
    const first = { shutdown: jest.fn().mockResolvedValue(undefined) };
    const second = { shutdown: jest.fn().mockResolvedValue(undefined) };

    await shutdownAll([first, second]);

    expect(first.shutdown).toHaveBeenCalledTimes(1);
    expect(second.shutdown).toHaveBeenCalledTimes(1);
  });

  it("resolves when a provider fails and reports it", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("boom");
    const failing = { shutdown: jest.fn().mockRejectedValue(failure) };
    const healthy = { shutdown: jest.fn().mockResolvedValue(undefined) };

    await expect(shutdownAll([failing, healthy])).resolves.toBeUndefined();

    expect(healthy.shutdown).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[otel-utils] shutdown failed",
      failure,
    );
    warnSpy.mockRestore();
  });
});

describe("registerShutdownHooks", () => {
  it("flushes the providers and exits once on SIGTERM/SIGINT", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const provider = { shutdown: jest.fn().mockResolvedValue(undefined) };
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sigintListeners = process.listenerCount("SIGINT");

    const cleanup = registerShutdownHooks([provider]);
    try {
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners + 1);

      process.emit("SIGTERM");
      await new Promise((resolve) => setImmediate(resolve));
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);

      process.emit("SIGINT");
      await new Promise((resolve) => setImmediate(resolve));
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }

    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
  });

  it("the cleanup function removes both listeners without shutting down", () => {
    const provider = { shutdown: jest.fn().mockResolvedValue(undefined) };
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sigintListeners = process.listenerCount("SIGINT");

    const cleanup = registerShutdownHooks([provider]);
    cleanup();

    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    expect(provider.shutdown).not.toHaveBeenCalled();
  });
});
