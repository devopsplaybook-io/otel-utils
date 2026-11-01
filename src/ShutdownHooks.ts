import { normalizePositiveInteger } from "./utils/configValidation";

export interface ShutdownableInterface {
  shutdown(): Promise<void>;
}

export interface RegisterShutdownHooksOptions {
  /**
   * Signals that trigger the shutdown. Defaults to `["SIGTERM", "SIGINT"]`.
   * Duplicates are removed.
   */
  signals?: NodeJS.Signals[];
  /**
   * Upper bound of the flush, in milliseconds. Defaults to 10 000 ms; invalid
   * values fall back to the default.
   */
  timeoutMillis?: number;
  /**
   * When `true` (default) the process exits with code 0 once the flush
   * completes or times out. When `false` the providers are flushed without
   * calling `process.exit`, leaving the exit to the application.
   */
  exit?: boolean;
}

const DEFAULT_SIGNALS: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
const DEFAULT_TIMEOUT_MILLIS = 10_000;

/**
 * Flushes and shuts down every provider, resolving even when one of them
 * fails (the failure is reported with `console.warn`). There is no timeout:
 * use {@link registerShutdownHooks} for a bounded flush.
 */
export async function shutdownAll(
  providers: ReadonlyArray<ShutdownableInterface>,
): Promise<void> {
  await Promise.all(
    providers.map((provider) =>
      Promise.resolve()
        .then(() => provider.shutdown())
        .catch((error: unknown) => {
          console.warn("[otel-utils] shutdown failed", error);
        }),
    ),
  );
}

function shutdownWithTimeout(
  providers: ReadonlyArray<ShutdownableInterface>,
  timeoutMillis: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      console.warn(
        `[otel-utils] shutdown timed out after ${timeoutMillis} ms; continuing without waiting for the remaining providers`,
      );
      resolve();
    }, timeoutMillis);

    void shutdownAll(providers).then(finish, finish);
  });
}

/**
 * Registers `SIGTERM`/`SIGINT` handlers that flush and shut down all providers.
 *
 * A signal starts one bounded shutdown: further signals (the same one or the
 * other one) are ignored while it runs, so a repeated signal can neither
 * re-flush nor terminate the process mid-flush. The flush is bounded by
 * `timeoutMillis`; when it elapses a warning is logged and the process
 * continues instead of hanging. Listeners are removed when the flush completes
 * and by the returned cleanup function, restoring Node's default signal
 * behaviour.
 *
 * With the default `exit: true` the process exits with code 0 after the flush;
 * with `exit: false` it only flushes, for applications that own their shutdown
 * sequence. Register once with every configured provider. The returned
 * function removes the listeners without shutting anything down; it is
 * idempotent and does not cancel an in-flight flush.
 */
export function registerShutdownHooks(
  providers: ReadonlyArray<ShutdownableInterface>,
  options: RegisterShutdownHooksOptions = {},
): () => void {
  const signals = [...new Set(options.signals ?? DEFAULT_SIGNALS)];
  const timeoutMillis = normalizePositiveInteger(
    options.timeoutMillis,
    DEFAULT_TIMEOUT_MILLIS,
  );
  const exitOnComplete = options.exit ?? true;
  let shuttingDown = false;

  function cleanup(): void {
    for (const signal of signals) {
      process.removeListener(signal, onSignal);
    }
  }

  function runShutdown(): void {
    void shutdownWithTimeout(providers, timeoutMillis).then(() => {
      cleanup();
      if (exitOnComplete) {
        process.exit(0);
      }
    });
  }

  function onSignal(): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    runShutdown();
  }

  for (const signal of signals) {
    process.on(signal, onSignal);
  }
  return cleanup;
}
