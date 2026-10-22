export interface ShutdownableInterface {
  shutdown(): Promise<void>;
}

/**
 * Flushes and shuts down every provider, resolving even when one of them
 * fails (the failure is reported with `console.warn`).
 */
export async function shutdownAll(
  providers: ReadonlyArray<ShutdownableInterface>,
): Promise<void> {
  await Promise.all(
    providers.map((provider) =>
      provider.shutdown().catch((error: unknown) => {
        console.warn("[otel-utils] shutdown failed", error);
      }),
    ),
  );
}

/**
 * Registers one-shot `SIGTERM`/`SIGINT` handlers that flush and shut down all
 * providers, then exit the process with code 0.
 *
 * Register once with every configured provider. The returned function removes
 * the handlers without shutting anything down.
 */
export function registerShutdownHooks(
  providers: ReadonlyArray<ShutdownableInterface>,
): () => void {
  let shuttingDown = false;
  const onSignal = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void shutdownAll(providers).then(() => process.exit(0));
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return () => {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  };
}
