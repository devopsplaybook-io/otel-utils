import {
  registerShutdownHooks,
  type ShutdownableInterface,
  shutdownAll,
} from "./ShutdownHooks";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

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

  it("resolves when a provider throws synchronously and reports it", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("sync-boom");
    const throwing: ShutdownableInterface = {
      shutdown: () => {
        throw failure;
      },
    };
    const healthy = { shutdown: jest.fn().mockResolvedValue(undefined) };

    await expect(shutdownAll([throwing, healthy])).resolves.toBeUndefined();

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
      await flushMicrotasks();
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);

      process.emit("SIGINT");
      await flushMicrotasks();
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }

    expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
  });

  it("keeps listening and ignores a repeated SIGTERM while the flush is pending", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const gate = deferred();
    const provider = { shutdown: jest.fn(() => gate.promise) };
    const sigtermListeners = process.listenerCount("SIGTERM");

    const cleanup = registerShutdownHooks([provider]);
    try {
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);

      expect(process.emit("SIGTERM")).toBe(true);
      await flushMicrotasks();
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners + 1);
      expect(exitSpy).not.toHaveBeenCalled();

      // A real second signal must still find the listener (not Node's default
      // action) and must not trigger another flush or an early exit.
      expect(process.emit("SIGTERM")).toBe(true);
      await flushMicrotasks();
      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();

      gate.resolve();
      await flushMicrotasks();
      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }
  });

  it("removes the listeners after a flush with exit: false and never exits", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const provider = { shutdown: jest.fn().mockResolvedValue(undefined) };
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sigintListeners = process.listenerCount("SIGINT");

    const cleanup = registerShutdownHooks([provider], { exit: false });
    try {
      process.emit("SIGTERM");
      await flushMicrotasks();

      expect(provider.shutdown).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
    } finally {
      cleanup();
      exitSpy.mockRestore();
    }
  });

  it("continues after the bounded timeout of a never-resolving provider", async () => {
    jest.useFakeTimers();
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const provider = {
      shutdown: jest.fn(() => new Promise<void>(() => undefined)),
    };
    const sigtermListeners = process.listenerCount("SIGTERM");

    const cleanup = registerShutdownHooks([provider], {
      timeoutMillis: 25,
      exit: false,
    });
    try {
      process.emit("SIGTERM");
      await jest.advanceTimersByTimeAsync(25);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("shutdown timed out after 25 ms"),
      );
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      cleanup();
      exitSpy.mockRestore();
      warnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("ignores a provider that settles after the timeout already resolved the shutdown", async () => {
    jest.useFakeTimers();
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const gate = deferred();
    const provider = { shutdown: jest.fn(() => gate.promise) };
    const sigtermListeners = process.listenerCount("SIGTERM");

    const cleanup = registerShutdownHooks([provider], {
      timeoutMillis: 25,
      exit: false,
    });
    try {
      process.emit("SIGTERM");
      await jest.advanceTimersByTimeAsync(25);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      gate.resolve();
      await jest.advanceTimersByTimeAsync(0);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
    } finally {
      cleanup();
      exitSpy.mockRestore();
      warnSpy.mockRestore();
      jest.useRealTimers();
    }
  });

  it("registers only the configured signals", () => {
    const provider = { shutdown: jest.fn().mockResolvedValue(undefined) };
    const sigtermListeners = process.listenerCount("SIGTERM");
    const sigintListeners = process.listenerCount("SIGINT");
    const sigusr2Listeners = process.listenerCount("SIGUSR2");

    const cleanup = registerShutdownHooks([provider], { signals: ["SIGUSR2"] });
    try {
      expect(process.listenerCount("SIGTERM")).toBe(sigtermListeners);
      expect(process.listenerCount("SIGINT")).toBe(sigintListeners);
      expect(process.listenerCount("SIGUSR2")).toBe(sigusr2Listeners + 1);
    } finally {
      cleanup();
    }

    expect(process.listenerCount("SIGUSR2")).toBe(sigusr2Listeners);
  });

  it("exits with code 0 even when a provider fails", async () => {
    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new Error("boom");
    const provider = { shutdown: jest.fn().mockRejectedValue(failure) };

    const cleanup = registerShutdownHooks([provider]);
    try {
      process.emit("SIGTERM");
      await flushMicrotasks();

      expect(warnSpy).toHaveBeenCalledWith(
        "[otel-utils] shutdown failed",
        failure,
      );
      expect(exitSpy).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      cleanup();
      exitSpy.mockRestore();
      warnSpy.mockRestore();
    }
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
